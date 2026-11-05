import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { env } from "../config/env.js";
import { HttpError } from "../middleware/error.js";

export const uploadRoot = path.resolve(env.UPLOAD_DIR);

const MB = 1024 * 1024;

function diskUpload(folder: string, allowed: RegExp, maxFiles: number) {
  const dir = path.join(uploadRoot, folder);
  fs.mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (_req, file, cb) =>
        cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 10 * MB, files: maxFiles },
    fileFilter: (_req, file, cb) =>
      allowed.test(file.originalname.toLowerCase())
        ? cb(null, true)
        : cb(new HttpError(400, `File type not allowed: ${file.originalname}`)),
  });
}

/** Supporting documents on requests (medical certificate etc.) */
export const attachmentUpload = diskUpload("attachments", /\.(pdf|jpe?g|png)$/, 5);

/**
 * Request forms: "attachments" (up to 5, leave / attendance update) or one "receipt_<line>" per expense line.
 */
export const requestFilesUpload = multer({
  storage: multer.diskStorage({
    destination: path.join(uploadRoot, "attachments"),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 10 * MB, files: 30 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname !== "attachments" && !/^receipt_\d{1,2}$/.test(file.fieldname)) return cb(new HttpError(400, `Unexpected file field ${file.fieldname}`));
    if (!/\.(pdf|jpe?g|png)$/.test(file.originalname.toLowerCase())) return cb(new HttpError(400, `File type not allowed: ${file.originalname} (PDF, JPG or PNG)`));
    cb(null, true);
  },
});
/** Hiring: job descriptions and CVs (PDF or Word) */
export const hiringUpload = diskUpload("hiring", /\.(pdf|docx?)$/, 1);
/** Policies and HR forms */
export const documentUpload = diskUpload("documents", /\.pdf$/, 1);
/** Generated letters */
export const lettersDir = path.join(uploadRoot, "letters");
fs.mkdirSync(lettersDir, { recursive: true });

/** Spreadsheet imports are parsed in memory and not stored. */
export const sheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * MB, files: 1 },
  fileFilter: (_req, file, cb) =>
    /\.(xlsx|csv)$/.test(file.originalname.toLowerCase())
      ? cb(null, true)
      : cb(new HttpError(400, "Upload an Excel (.xlsx) or CSV file")),
});

/** Paths stored in the DB are relative to the upload root. */
export const relativeUploadPath = (absolute: string) => path.relative(uploadRoot, absolute).split(path.sep).join("/");
export const absoluteUploadPath = (relative: string) => path.join(uploadRoot, relative);

export function removeFiles(files: Express.Multer.File[] | undefined) {
  for (const f of files ?? []) fs.rm(f.path, { force: true }, () => {});
}
