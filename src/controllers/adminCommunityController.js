import {
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  createEvent,
  updateEvent,
  deleteEvent,
  createSocialLink,
  updateSocialLink,
  deleteSocialLink,
  createResource,
  updateResource,
  deleteResource,
} from '../services/admin/communityAdminService.js';

function setNoStore(res) {
  res.set('Cache-Control', 'no-store');
}

export async function postAnnouncement(req, res, next) {
  try {
    const data = await createAnnouncement(req.body);
    setNoStore(res);
    res.status(201).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function patchAnnouncement(req, res, next) {
  try {
    const data = await updateAnnouncement(req.params.id, req.body);
    setNoStore(res);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function removeAnnouncement(req, res, next) {
  try {
    const data = await deleteAnnouncement(req.params.id);
    setNoStore(res);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function postEvent(req, res, next) {
  try {
    const data = await createEvent(req.body);
    setNoStore(res);
    res.status(201).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function patchEvent(req, res, next) {
  try {
    const data = await updateEvent(req.params.id, req.body);
    setNoStore(res);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function removeEvent(req, res, next) {
  try {
    const data = await deleteEvent(req.params.id);
    setNoStore(res);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function postSocialLink(req, res, next) {
  try {
    const data = await createSocialLink(req.body);
    setNoStore(res);
    res.status(201).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function patchSocialLink(req, res, next) {
  try {
    const data = await updateSocialLink(req.params.id, req.body);
    setNoStore(res);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function removeSocialLink(req, res, next) {
  try {
    const data = await deleteSocialLink(req.params.id);
    setNoStore(res);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function postResource(req, res, next) {
  try {
    const data = await createResource(req.body);
    setNoStore(res);
    res.status(201).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function patchResource(req, res, next) {
  try {
    const data = await updateResource(req.params.id, req.body);
    setNoStore(res);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function removeResource(req, res, next) {
  try {
    const data = await deleteResource(req.params.id);
    setNoStore(res);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}












// import {
//   createAnnouncement,
//   updateAnnouncement,
//   deleteAnnouncement,
//   createEvent,
//   updateEvent,
//   deleteEvent,
//   createSocialLink,
//   updateSocialLink,
//   deleteSocialLink,
//   createResource,
//   updateResource,
//   deleteResource,
// } from '../services/admin/communityAdminService.js';

// export async function postAnnouncement(req, res, next) {
//   try {
//     const data = await createAnnouncement(req.body);
//     res.status(201).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function patchAnnouncement(req, res, next) {
//   try {
//     const data = await updateAnnouncement(req.params.id, req.body);
//     res.status(200).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function removeAnnouncement(req, res, next) {
//   try {
//     const data = await deleteAnnouncement(req.params.id);
//     res.status(200).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function postEvent(req, res, next) {
//   try {
//     const data = await createEvent(req.body);
//     res.status(201).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function patchEvent(req, res, next) {
//   try {
//     const data = await updateEvent(req.params.id, req.body);
//     res.status(200).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function removeEvent(req, res, next) {
//   try {
//     const data = await deleteEvent(req.params.id);
//     res.status(200).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function postSocialLink(req, res, next) {
//   try {
//     const data = await createSocialLink(req.body);
//     res.status(201).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function patchSocialLink(req, res, next) {
//   try {
//     const data = await updateSocialLink(req.params.id, req.body);
//     res.status(200).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function removeSocialLink(req, res, next) {
//   try {
//     const data = await deleteSocialLink(req.params.id);
//     res.status(200).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function postResource(req, res, next) {
//   try {
//     const data = await createResource(req.body);
//     res.status(201).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function patchResource(req, res, next) {
//   try {
//     const data = await updateResource(req.params.id, req.body);
//     res.status(200).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function removeResource(req, res, next) {
//   try {
//     const data = await deleteResource(req.params.id);
//     res.status(200).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }