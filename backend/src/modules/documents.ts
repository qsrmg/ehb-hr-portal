import fs from "node:fs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { absoluteUploadPath, documentUpload, relativeUploadPath, removeFiles } from "../lib/upload.js";
import { documentPolicyKey } from "../lib/policies.js";
import { HttpError } from "../middleware/error.js";
import { currentUser, requireAuth, requireRole } from "../middleware/auth.js";
import { acknowledgePolicy, documentHasAcknowledgements, getAcknowledgementReport } from "../services/policyAcknowledgement.js";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

const bool = z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean());

documentsRouter.get("/", async (req, res) => {
  const user = currentUser(req);
  const category = req.query.category === "POLICY" || req.query.category === "HR_FORM" ? req.query.category : undefined;
  const rows = await prisma.document.findMany({
    where: category ? { category } : {},
    orderBy: [{ category: "asc" }, { title: "asc" }],
    include: { uploadedBy: { select: { fullName: true } }, policyAcknowledgements: { where: { employeeId: user.id }, select: { acknowledgedAt: true } } },
  });
  res.json(rows.map((d) => ({
    id: d.id, title: d.title, description: d.description, category: d.category, fileName: d.fileName,
    size: d.size, createdAt: d.createdAt, uploadedBy: d.uploadedBy.fullName,
    requiresAcknowledgement: d.requiresAcknowledgement, acknowledgedAt: d.policyAcknowledgements[0]?.acknowledgedAt ?? null,
  })));
});

const schema = z.object({
  title: z.string().trim().min(2, "Give the document a title"),
  description: z.string().trim().optional(),
  category: z.enum(["POLICY", "HR_FORM"]),
  requiresAcknowledgement: bool.optional().default(false),
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
  await audit(user.id, "CREATE", "Document", doc.id, { title: doc.title, requiresAcknowledgement: doc.requiresAcknowledgement });
  res.status(201).json({ id: doc.id });
});

documentsRouter.get("/:id/download", async (req, res) => {
  const doc = await prisma.document.findUnique({ where: { id: Number(req.params.id) } });
  if (!doc) throw new HttpError(404, "Document not found");
  const file = absoluteUploadPath(doc.path);
  if (!fs.existsSync(file)) throw new HttpError(404, "File is missing from storage");
  res.download(file, doc.fileName);
});

// Dress Code Policy design 1: a timestamped acknowledgement, no login blocking. Submitting again is a no-op
// (acknowledgePolicy treats a race between a double-click / two tabs the same way, never a 500).
documentsRouter.post("/:id/acknowledge", async (req, res) => {
  const user = currentUser(req);
  const id = Number(req.params.id);
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) throw new HttpError(404, "Document not found");
  const ack = await acknowledgePolicy(user.id, documentPolicyKey(id), "Document", id);
  res.json({ ok: true, acknowledgedAt: ack.acknowledgedAt });
});

// HR sees who has not yet acknowledged a document that requires it.
documentsRouter.get("/:id/acknowledgements", requireRole("HR"), async (req, res) => {
  const id = Number(req.params.id);
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) throw new HttpError(404, "Document not found");
  res.json(await getAcknowledgementReport(documentPolicyKey(id)));
});

documentsRouter.delete("/:id", requireRole("HR"), async (req, res) => {
  const doc = await prisma.document.findUnique({ where: { id: Number(req.params.id) } });
  if (!doc) throw new HttpError(404, "Document not found");
  if (await documentHasAcknowledgements(doc.id)) throw new HttpError(409, "This document has acknowledgements and cannot be deleted");
  await prisma.document.delete({ where: { id: doc.id } });
  fs.rm(absoluteUploadPath(doc.path), { force: true }, () => {});
  await audit(currentUser(req).id, "DELETE", "Document", doc.id, { title: doc.title });
  res.json({ ok: true });
});
