import {
  fetchOrbitLevels,
  fetchOrbitLevelSnapshot,
  fetchOrbitPositionDetails,
  fetchOrbitCycleSnapshot,
} from '../services/read/orbitQueryService.js';

export async function getOrbitLevels(req, res, next) {
  try {
    const { address } = req.params;
    const data = await fetchOrbitLevels(address);

    res.status(200).json({
      ok: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getOrbitLevelSnapshot(req, res, next) {
  try {
    const { address, level } = req.params;
    const data = await fetchOrbitLevelSnapshot(address, Number(level));

    res.status(200).json({
      ok: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getOrbitPositionDetails(req, res, next) {
  try {
    const { address, level, position } = req.params;
    const data = await fetchOrbitPositionDetails(
      address,
      Number(level),
      Number(position)
    );

    res.status(200).json({
      ok: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getOrbitCycleSnapshot(req, res, next) {
  try {
    const { address, level, cycleNumber } = req.params;
    const data = await fetchOrbitCycleSnapshot(
      address,
      Number(level),
      Number(cycleNumber)
    );

    res.status(200).json({
      ok: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}