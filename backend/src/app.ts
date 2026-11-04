import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./modules/auth.js";
import { employeesRouter } from "./modules/employees.js";
import { departmentsRouter } from "./modules/departments.js";
import { dashboardRouter } from "./modules/dashboard.js";
import { attendanceRouter } from "./modules/attendance.js";
import { leaveRouter } from "./modules/leave.js";
import { requestsRouter } from "./modules/requests.js";
import { payrollRouter } from "./modules/payroll.js";
import { documentsRouter } from "./modules/documents.js";
import { adminRouter } from "./modules/admin.js";
import { expensesRouter } from "./modules/expenses.js";
import { travelRouter } from "./modules/travel.js";
import { errorHandler, notFound } from "./middleware/error.js";

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true, exposedHeaders: ["Content-Disposition"] }));
app.use(express.json());
if (env.NODE_ENV !== "test") app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/employees", employeesRouter);
app.use("/api/departments", departmentsRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/attendance", attendanceRouter);
app.use("/api/leave", leaveRouter);
app.use("/api/requests", requestsRouter);
app.use("/api/payroll", payrollRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/expenses", expensesRouter);
app.use("/api/travel", travelRouter);
app.use("/api", adminRouter);

app.use(notFound);
app.use(errorHandler);
