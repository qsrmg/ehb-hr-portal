import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { HttpError } from "../middleware/error.js";
import { isYmd, ymd } from "./dates.js";

export type SheetRow = Record<string, unknown>;

/** Lower-case header with everything but letters and digits removed: "Check In" -> "checkin". */
export const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if ("result" in value) return cellValue(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((t) => t.text).join("");
    if ("text" in value) return value.text;
    return null;
  }
  return value;
}

/** Reads the first worksheet of an .xlsx or .csv file into objects keyed by normalized header. */
export async function readSheet(buffer: Buffer, fileName: string): Promise<SheetRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    if (fileName.toLowerCase().endsWith(".csv")) {
      // Identity map keeps CSV values as strings, so dates are parsed by our own rules below.
      await workbook.csv.read(Readable.from(buffer), { map: (v: unknown) => v } as never);
    } else {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    }
  } catch {
    throw new HttpError(400, "Could not read the file. Check that it is a valid Excel or CSV file.");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new HttpError(400, "The file has no worksheet");

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = normalizeHeader(String(cellValue(cell.value) ?? ""));
  });

  const rows: SheetRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: SheetRow = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = headers[col];
      if (!key) return;
      const v = cellValue(cell.value);
      if (v !== null && v !== "") hasValue = true;
      obj[key] = typeof v === "string" ? v.trim() : v;
    });
    if (hasValue) rows.push(obj);
  });
  return rows;
}

/** First non-empty value among the given header aliases. */
export function pick(row: SheetRow, aliases: string[]) {
  for (const a of aliases) {
    const v = row[a];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

export const pickString = (row: SheetRow, aliases: string[]) => {
  const v = pick(row, aliases);
  return v == null ? null : String(v).trim() || null;
};

export const hasAny = (rows: SheetRow[], aliases: string[]) => rows.some((r) => aliases.some((a) => a in r));

/** Accepts Excel dates, "2026-10-01", "01/10/2026" or "01-10-2026" (day first, as used in Pakistan). */
export function parseSheetDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return ymd(v);
  if (typeof v === "number") return ymd(new Date(Math.round((v - 25569) * 86_400_000))); // Excel serial
  const s = String(v).trim().split(/[ T]/)[0] ?? "";
  if (isYmd(s)) return s;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const out = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
    return isYmd(out) ? out : null;
  }
  return null;
}

/** Accepts Excel times, "09:12", "9:12 AM", "09:12:33" or a full "2026-10-01 09:12" timestamp. Returns minutes. */
export function parseSheetTime(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.getUTCHours() * 60 + v.getUTCMinutes();
  if (typeof v === "number") return Math.round((v % 1) * 1440) % 1440; // fraction of a day
  const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?\s*$/i.exec(String(v).trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ampm = m[3]?.toLowerCase().replace(/\./g, "");
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function parseSheetNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
}
