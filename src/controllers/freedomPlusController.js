import {
  freedomPlusEvents,
  freedomPlusDashboard,
  freedomPlusOrbit,
  freedomPlusParticipant,
  freedomPlusActivationSummary,
  freedomPlusPayments,
  freedomPlusReconciliation,
  freedomPlusStatus,
  freedomPlusRewardProof,
  listFreedomPlusRewardPeriods,
} from '../services/read/freedomPlusQueryService.js';

function handler(fn) {
  return async (req, res) => {
    try { res.json({ ok: true, data: await fn(req) }); }
    catch (error) { res.status(400).json({ ok: false, error: String(error?.message || error) }); }
  };
}

export const getFreedomPlusStatus = handler(() => freedomPlusStatus());
export const getFreedomPlusDashboard = handler((req) => freedomPlusDashboard(req.params.address));
export const getFreedomPlusReconciliation = handler(() => freedomPlusReconciliation());
export const getFreedomPlusParticipant = handler((req) => freedomPlusParticipant(req.params.address));
export const getFreedomPlusActivationSummary = handler((req) => freedomPlusActivationSummary(req.params.address));
export const getFreedomPlusOrbit = handler((req) => freedomPlusOrbit(req.params.address, req.params.level, req.query));
export const getFreedomPlusPayments = handler((req) => freedomPlusPayments(req.params.address, req.query));
export const getFreedomPlusEvents = handler((req) => freedomPlusEvents(req.params.address, req.query));
export const getFreedomPlusRewardPeriods = handler(() => listFreedomPlusRewardPeriods());
export const getFreedomPlusRewardProof = handler((req) => freedomPlusRewardProof(req.params.periodId, req.params.address));
