import fs from "node:fs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { absoluteUploadPath, documentUpload, relativeUploadPath, removeFiles } from "../lib/upload.js";
import { HttpError } from "../middleware/error.js";
import { currentUser, requireAuth, requireRole } from "../middleware/auth.js";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

documentsRouter.get("/", async (req, res) => {
  const category = req.query.category === "POLICY" || req.query.category === "HR_FORM" ? req.query.category : undefined;
  const rows = await prisma.document.findMany({
    where: category ? { category } : {},
    orderBy: [{ category: "asc" }, { title: "asc" }],
    include: { uploadedBy: { select: { fullName: true } } },
  });
  res.json(rows.map((d) => ({
    id: d.id, title: d.title, description: d.description, category: d.category, fileName: d.fileName,
    size: d.size, createdAt: d.createdAt, uploadedBy: d.uploadedBy.fullName,
  })));
});

const schema = z.object({
  title: z.string().trim().min(2, "Give the document a title"),
  description: z.string().trim().optional(),
  category: z.enum(["POLICY", "HR_FORM"]),
});

documentsRouter.post("/", requireRole("HR"), documentUpload.single("file"), async (req, res) => {
  const user = currentUser(req);
  const file = req.file;
  const parsed = schema.safeParse(req.body);
  if (!file || !parsed.success) {
    removeFiles(file ? [file] : []);
    throw new HttpError(400, !file ? "Choose a PDF file" : parsed.error!.issues.map((i) => i.message).join("; "));
  }
  const doc = await prisma.document.create({
    data: {
      ...parsed.data, description: parsed.data.description || null,
      fileName: file.originalname, path: relativeUploadPath(file.path), mimeType: file.mimetype, size: file.size, uploadedById: user.id,
    },
  });
  await audit(user.id, "CREATE", "Document", doc.id, { title: doc.title });
  res.status(201).json({ id: doc.id });
});

documentsRouter.get("/:id/download", async (req, res) => {
  const doc = await prisma.document.findUnique({ where: { id: Number(req.params.id) } });
  if (!doc) throw new HttpError(404, "Document not found");
  const file = absoluteUploadPath(doc.path);
  if (!fs.existsSync(file)) throw new HttpError(404, "File is missing from storage");
  res.download(file, doc.fileName);
});

documentsRouter.delete("/:id", requireRole("HR"), async (req, res) => {
  const doc = await prisma.document.findUnique({ where: { id: Number(req.params.id) } });
  if (!doc) throw new HttpError(404, "Document not found");
  await prisma.document.delete({ where: { id: doc.id } });
  fs.rm(absoluteUploadPath(doc.path), { force: true }, () => {});
  await audit(currentUser(req).id, "DELETE", "Document", doc.id, { title: doc.title });
  res.json({ ok: true });
});
