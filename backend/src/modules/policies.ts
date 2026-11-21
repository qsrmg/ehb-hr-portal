import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getAcknowledgementReport } from "../services/policyAcknowledgement.js";

export const policiesRouter = Router();
policiesRouter.use(requireAuth);

// HR report: who has and has not acknowledged a policy's current version. Resolving the policy key
// (registry entry, or an existing "document:<id>") is what turns an unknown key into a 404.
policiesRouter.get("/:policyKey/acknowledgements", requireRole("HR"), async (req, res) => {
  res.json(await getAcknowledgementReport(String(req.params.policyKey)));
});
