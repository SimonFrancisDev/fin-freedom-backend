import mongoose from 'mongoose';
import env from '../../config/env.js';
import EngagementTask from '../../models/EngagementTask.js';
import TaskParticipation from '../../models/TaskParticipation.js';
import TaskSubmission from '../../models/TaskSubmission.js';
import TaskComment from '../../models/TaskComment.js';
import TaskReaction from '../../models/TaskReaction.js';
import TaskReward from '../../models/TaskReward.js';
import FreedomPlusParticipant from '../../models/FreedomPlusParticipant.js';
import IndexedRegistrationEvent from '../../models/IndexedRegistrationEvent.js';
import { findNotificationImage } from '../notifications/notificationMediaService.js';
import { findTaskProofImage } from './taskMediaService.js';
import { sendAdminMessage } from '../notifications/adminMessageService.js';
import { publishTaskEvent } from './taskLiveService.js';

const TASK_STATUSES = new Set(['draft', 'published', 'closed', 'archived']);
const REACTIONS = new Set(['applaud', 'like', 'celebrate']);
const REVIEW_STATUSES = new Set(['approved', 'rejected']);
const REWARD_STATUSES = new Set(['pending', 'earned', 'issued', 'failed', 'cancelled']);

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function text(value, label, max, required = false) { const result = String(value || '').trim(); if (required && !result) fail(`${label} is required`); if (result.length > max) fail(`${label} must be ${max} characters or fewer`); return result; }
function objectId(value, label = 'ID') { if (!mongoose.isValidObjectId(value)) fail(`${label} is invalid`); return new mongoose.Types.ObjectId(value); }
function dateValue(value, label) { if (!value) return null; const date = new Date(value); if (Number.isNaN(date.getTime())) fail(`${label} is invalid`); return date; }
function httpsUrl(value, label, required = false) { const result = text(value, label, 500, required); if (!result) return ''; let url; try { url = new URL(result); } catch { fail(`${label} must be a valid URL`); } if (url.protocol !== 'https:') fail(`${label} must use HTTPS`); return url.toString(); }

export async function requireRegisteredWallet(walletAddress) {
  const wallet = String(walletAddress || '').trim().toLowerCase();
  const escapedWallet = wallet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const walletMatch = { $regex: `^${escapedWallet}$`, $options: 'i' };
  const [freedom, plus] = await Promise.all([
    IndexedRegistrationEvent.exists({ chainId: env.CHAIN_ID, user: walletMatch }),
    FreedomPlusParticipant.exists({ chainId: env.CHAIN_ID, wallet: walletMatch, registered: true }),
  ]);
  if (!freedom && !plus) fail('Only indexed registered users can use Tasks', 403);
  return wallet;
}

export function taskState(task, now = new Date()) {
  if (task.status !== 'published') return task.status;
  if (task.startsAt && new Date(task.startsAt) > now) return 'upcoming';
  if (task.endsAt && new Date(task.endsAt) < now) return 'expired';
  return 'active';
}

function serializeTask(task, extras = {}) {
  const item = task?.toObject ? task.toObject() : task;
  return item ? { ...item, state: taskState(item), ...extras } : null;
}

async function taskCounts(taskIds) {
  const ids = taskIds.map((id) => new mongoose.Types.ObjectId(id));
  const [participants, submissions, comments, reactions] = await Promise.all([
    TaskParticipation.aggregate([{ $match: { taskId: { $in: ids } } }, { $group: { _id: '$taskId', count: { $sum: 1 } } }]),
    TaskSubmission.aggregate([{ $match: { taskId: { $in: ids } } }, { $group: { _id: '$taskId', count: { $sum: 1 } } }]),
    TaskComment.aggregate([{ $match: { taskId: { $in: ids }, isRemoved: false } }, { $group: { _id: '$taskId', count: { $sum: 1 } } }]),
    TaskReaction.aggregate([{ $match: { taskId: { $in: ids }, targetType: 'task' } }, { $group: { _id: '$taskId', count: { $sum: 1 } } }]),
  ]);
  const map = new Map();
  for (const [key, rows] of Object.entries({ participantCount: participants, submissionCount: submissions, commentCount: comments, reactionCount: reactions })) {
    for (const row of rows) map.set(String(row._id), { ...(map.get(String(row._id)) || {}), [key]: row.count });
  }
  return map;
}

export async function listAdminTasks() {
  const tasks = await EngagementTask.find().sort({ createdAt: -1 }).lean();
  const counts = await taskCounts(tasks.map((task) => task._id));
  return tasks.map((task) => serializeTask(task, counts.get(String(task._id)) || {}));
}

function taskPayload(input = {}, existing = null) {
  const status = input.status ?? existing?.status ?? 'draft';
  if (!TASK_STATUSES.has(status)) fail('Task status is invalid');
  const startsAt = dateValue(input.startsAt ?? existing?.startsAt, 'Start date');
  const endsAt = dateValue(input.endsAt ?? existing?.endsAt, 'End date');
  if (startsAt && endsAt && endsAt <= startsAt) fail('End date must be after start date');
  return {
    title: text(input.title ?? existing?.title, 'Title', 140, true),
    summary: text(input.summary ?? existing?.summary, 'Summary', 320, true),
    instructions: text(input.instructions ?? existing?.instructions, 'Instructions', 4000, true),
    actionUrl: httpsUrl(input.actionUrl ?? existing?.actionUrl, 'Action URL'),
    imageId: text(input.imageId ?? existing?.imageId, 'Image ID', 80),
    imageUrl: text(input.imageUrl ?? existing?.imageUrl, 'Image URL', 240),
    rewardLabel: text(input.rewardLabel ?? existing?.rewardLabel, 'Reward', 120),
    proofRequirements: text(input.proofRequirements ?? existing?.proofRequirements, 'Proof requirements', 1000),
    startsAt, endsAt, status,
  };
}

export async function createTask(input = {}) {
  const payload = taskPayload(input);
  if (payload.imageId && !(await findNotificationImage(payload.imageId))) fail('Task image was not found');
  payload.imageUrl = payload.imageId ? `/api/notifications/media/${payload.imageId}` : '';
  const task = await EngagementTask.create({ ...payload, createdBy: text(input.createdBy, 'Creator', 80) || 'admin' });
  let notification = null;
  if (task.status === 'published' && input.notifyUsers) {
    try { notification = await sendAdminMessage({ deliveryMode: 'broadcast', title: 'New community task', message: task.title, detail: task.summary, imageId: task.imageId, route: `tasks?task=${task._id}`, severity: 'info' }); }
    catch (error) { notification = { ok: false, warning: error.message }; }
  }
  publishTaskEvent(task.status === 'published' ? 'task-published' : 'task-created', { taskId: String(task._id) });
  return { task: serializeTask(task), notification };
}

export async function updateTask(id, input = {}) {
  const task = await EngagementTask.findById(objectId(id, 'Task ID'));
  if (!task) fail('Task was not found', 404);
  const previousStatus = task.status;
  const payload = taskPayload(input, task);
  if (payload.imageId && payload.imageId !== task.imageId && !(await findNotificationImage(payload.imageId))) fail('Task image was not found');
  payload.imageUrl = payload.imageId ? `/api/notifications/media/${payload.imageId}` : '';
  Object.assign(task, payload); await task.save();
  let notification = null;
  if (previousStatus !== 'published' && task.status === 'published' && input.notifyUsers) {
    try { notification = await sendAdminMessage({ deliveryMode: 'broadcast', title: 'New community task', message: task.title, detail: task.summary, imageId: task.imageId, route: `tasks?task=${task._id}`, severity: 'info' }); }
    catch (error) { notification = { ok: false, warning: error.message }; }
  }
  publishTaskEvent('task-updated', { taskId: String(task._id) });
  return { task: serializeTask(task), notification };
}

export async function archiveTask(id) { return updateTask(id, { status: 'archived' }); }

export async function listTasksForWallet(walletAddress) {
  const wallet = await requireRegisteredWallet(walletAddress);
  const tasks = await EngagementTask.find({ status: { $in: ['published', 'closed'] } }).sort({ createdAt: -1 }).lean();
  const ids = tasks.map((task) => task._id);
  const [counts, participations, submissions, reactions] = await Promise.all([
    taskCounts(ids),
    TaskParticipation.find({ taskId: { $in: ids }, walletAddress: wallet }).lean(),
    TaskSubmission.find({ taskId: { $in: ids }, walletAddress: wallet }).lean(),
    TaskReaction.find({ taskId: { $in: ids }, targetType: 'task', walletAddress: wallet }).lean(),
  ]);
  const participationMap = new Map(participations.map((row) => [String(row.taskId), row]));
  const submissionMap = new Map(submissions.map((row) => [String(row.taskId), row]));
  const reactionMap = new Map(reactions.map((row) => [String(row.taskId), row.reaction]));
  return tasks.map((task) => serializeTask(task, { ...(counts.get(String(task._id)) || {}), participation: participationMap.get(String(task._id)) || null, submission: submissionMap.get(String(task._id)) || null, myReaction: reactionMap.get(String(task._id)) || '' }));
}

async function activeTask(id) {
  const task = await EngagementTask.findById(objectId(id, 'Task ID'));
  if (!task || !['published', 'closed'].includes(task.status)) fail('Task was not found', 404);
  if (taskState(task) !== 'active') fail('This task is not currently open');
  return task;
}

export async function joinTask(id, walletAddress) {
  const wallet = await requireRegisteredWallet(walletAddress); const task = await activeTask(id);
  const row = await TaskParticipation.findOneAndUpdate({ taskId: task._id, walletAddress: wallet }, { $setOnInsert: { status: 'joined', joinedAt: new Date() } }, { new: true, upsert: true, setDefaultsOnInsert: true });
  publishTaskEvent('task-joined', { taskId: id }); return row;
}

export async function submitTaskProof(id, walletAddress, input = {}) {
  const wallet = await requireRegisteredWallet(walletAddress); const task = await activeTask(id);
  const proofText = text(input.proofText, 'Proof text', 3000);
  const proofUrl = httpsUrl(input.proofUrl, 'Proof URL');
  const proofImageId = text(input.proofImageId, 'Proof image ID', 80);
  if (!proofText && !proofUrl && !proofImageId) fail('Add proof text, a proof URL, or a proof image');
  if (proofImageId) { const media = await findTaskProofImage(proofImageId); if (!media || media.file.metadata?.walletAddress !== wallet) fail('Proof image was not found'); }
  const existing = await TaskSubmission.findOne({ taskId: task._id, walletAddress: wallet });
  if (existing?.status === 'approved') fail('An approved submission cannot be changed');
  const submission = await TaskSubmission.findOneAndUpdate({ taskId: task._id, walletAddress: wallet }, { $set: { proofText, proofUrl, proofImageId, status: 'submitted', reviewNote: '', reviewedAt: null, reviewedBy: '' } }, { new: true, upsert: true, setDefaultsOnInsert: true });
  await TaskParticipation.findOneAndUpdate({ taskId: task._id, walletAddress: wallet }, { $set: { status: 'submitted' }, $setOnInsert: { joinedAt: new Date() } }, { upsert: true });
  publishTaskEvent('submission-created', { taskId: id }); return submission;
}

export async function listTaskComments(id, walletAddress) {
  const wallet = await requireRegisteredWallet(walletAddress); objectId(id, 'Task ID');
  const comments = await TaskComment.find({ taskId: id }).sort({ createdAt: 1 }).lean();
  const ids = comments.map((row) => row._id);
  const [reactionRows, mine] = await Promise.all([
    TaskReaction.aggregate([{ $match: { targetType: 'comment', targetId: { $in: ids } } }, { $group: { _id: '$targetId', count: { $sum: 1 } } }]),
    TaskReaction.find({ targetType: 'comment', targetId: { $in: ids }, walletAddress: wallet }).lean(),
  ]);
  const counts = new Map(reactionRows.map((row) => [String(row._id), row.count]));
  const my = new Map(mine.map((row) => [String(row.targetId), row.reaction]));
  const mapped = comments.map((row) => ({ ...row, body: row.isRemoved ? 'Comment removed by moderation.' : row.body, reactionCount: counts.get(String(row._id)) || 0, myReaction: my.get(String(row._id)) || '' }));
  const roots = mapped.filter((row) => !row.parentCommentId); const replies = mapped.filter((row) => row.parentCommentId);
  return roots.map((root) => ({ ...root, replies: replies.filter((reply) => String(reply.parentCommentId) === String(root._id)) }));
}

export async function addTaskComment(id, walletAddress, input = {}) {
  const wallet = await requireRegisteredWallet(walletAddress); const task = await activeTask(id);
  const body = text(input.body, 'Comment', 1200, true); let parentCommentId = null;
  if (input.parentCommentId) { const parent = await TaskComment.findOne({ _id: objectId(input.parentCommentId, 'Parent comment ID'), taskId: task._id, isRemoved: false }); if (!parent) fail('Parent comment was not found', 404); if (parent.parentCommentId) fail('Replies can only be one level deep'); parentCommentId = parent._id; }
  const comment = await TaskComment.create({ taskId: task._id, walletAddress: wallet, body, parentCommentId });
  if (parentCommentId) {
    const parent = await TaskComment.findById(parentCommentId).lean();
    if (parent?.walletAddress && parent.walletAddress !== wallet) {
      sendAdminMessage({ walletAddress: parent.walletAddress, title: 'New task reply', message: task.title, detail: body, route: `tasks?task=${task._id}`, severity: 'info' }).catch(() => {});
    }
  }
  publishTaskEvent('comment-created', { taskId: id }); return comment;
}

export async function toggleReaction(taskId, walletAddress, input = {}) {
  const wallet = await requireRegisteredWallet(walletAddress); const task = await activeTask(taskId);
  const targetType = ['task', 'comment', 'submission'].includes(input.targetType) ? input.targetType : 'task';
  const targetId = targetType === 'task' ? task._id : objectId(input.targetId, 'Target ID');
  if (targetType === 'comment' && !(await TaskComment.exists({ _id: targetId, taskId: task._id, isRemoved: false }))) fail('Comment was not found', 404);
  if (targetType === 'submission' && !(await TaskSubmission.exists({ _id: targetId, taskId: task._id }))) fail('Submission was not found', 404);
  const reaction = REACTIONS.has(input.reaction) ? input.reaction : 'applaud';
  const existing = await TaskReaction.findOne({ targetType, targetId, walletAddress: wallet });
  if (existing) { await existing.deleteOne(); publishTaskEvent('reaction-removed', { taskId }); return { active: false, reaction: '' }; }
  await TaskReaction.create({ taskId: task._id, targetType, targetId, walletAddress: wallet, reaction });
  let recipient = '';
  if (targetType === 'comment') recipient = (await TaskComment.findById(targetId).select('walletAddress').lean())?.walletAddress || '';
  if (targetType === 'submission') recipient = (await TaskSubmission.findById(targetId).select('walletAddress').lean())?.walletAddress || '';
  if (recipient && recipient !== wallet) {
    sendAdminMessage({ walletAddress: recipient, title: 'New task reaction', message: task.title, detail: `Someone ${reaction === 'applaud' ? 'applauded' : 'reacted to'} your contribution.`, route: `tasks?task=${task._id}`, severity: 'info' }).catch(() => {});
  }
  publishTaskEvent('reaction-created', { taskId }); return { active: true, reaction };
}

export async function listWalletRewards(walletAddress) { const wallet = await requireRegisteredWallet(walletAddress); return TaskReward.find({ walletAddress: wallet }).populate('taskId', 'title rewardLabel').sort({ createdAt: -1 }).lean(); }

export async function listAdminSubmissions(status = '') {
  const query = status ? { status } : {};
  return TaskSubmission.find(query).populate('taskId', 'title rewardLabel status').sort({ createdAt: -1 }).lean();
}

export async function reviewSubmission(id, input = {}) {
  const status = input.status; if (!REVIEW_STATUSES.has(status)) fail('Review status must be approved or rejected');
  const submission = await TaskSubmission.findById(objectId(id, 'Submission ID')).populate('taskId'); if (!submission) fail('Submission was not found', 404);
  submission.status = status; submission.reviewNote = text(input.reviewNote, 'Review note', 1200); submission.reviewedAt = new Date(); submission.reviewedBy = text(input.reviewedBy, 'Reviewer', 80) || 'admin'; await submission.save();
  if (status === 'approved') {
    await TaskParticipation.updateOne({ taskId: submission.taskId._id, walletAddress: submission.walletAddress }, { $set: { status: 'completed' } });
    await TaskReward.findOneAndUpdate({ submissionId: submission._id }, { $setOnInsert: { taskId: submission.taskId._id, walletAddress: submission.walletAddress, rewardLabel: submission.taskId.rewardLabel, status: 'earned', updatedBy: submission.reviewedBy } }, { upsert: true });
  }
  let notification = null;
  try { notification = await sendAdminMessage({ walletAddress: submission.walletAddress, title: `Task ${status}`, message: submission.taskId.title, detail: submission.reviewNote || (status === 'approved' ? 'Your task proof was approved.' : 'Review the feedback and submit again.'), route: `tasks?task=${submission.taskId._id}`, severity: status === 'approved' ? 'success' : 'warning' }); }
  catch (error) { notification = { ok: false, warning: error.message }; }
  publishTaskEvent('submission-reviewed', { taskId: String(submission.taskId._id) }); return { submission, notification };
}

export async function moderateComment(id, input = {}) {
  const comment = await TaskComment.findById(objectId(id, 'Comment ID')); if (!comment) fail('Comment was not found', 404);
  comment.isRemoved = true; comment.removedAt = new Date(); comment.removedBy = text(input.removedBy, 'Moderator', 80) || 'admin'; await comment.save(); publishTaskEvent('comment-moderated', { taskId: String(comment.taskId) }); return comment;
}

export async function listAdminComments(taskId = '') { const query = taskId ? { taskId: objectId(taskId, 'Task ID') } : {}; return TaskComment.find(query).sort({ createdAt: -1 }).limit(500).lean(); }

export async function updateReward(id, input = {}) {
  const reward = await TaskReward.findById(objectId(id, 'Reward ID')); if (!reward) fail('Reward was not found', 404);
  if (!REWARD_STATUSES.has(input.status)) fail('Reward status is invalid'); reward.status = input.status; reward.transactionHash = text(input.transactionHash, 'Transaction hash', 100); reward.note = text(input.note, 'Reward note', 1200); reward.updatedBy = text(input.updatedBy, 'Administrator', 80) || 'admin'; reward.issuedAt = input.status === 'issued' ? new Date() : reward.issuedAt; await reward.save();
  sendAdminMessage({ walletAddress: reward.walletAddress, title: `Task reward ${reward.status}`, message: reward.rewardLabel || 'Community task reward', detail: reward.note || (reward.status === 'issued' ? 'Your reward has been marked as issued.' : `Reward status: ${reward.status}`), route: 'tasks', severity: reward.status === 'issued' ? 'success' : 'info' }).catch(() => {});
  publishTaskEvent('reward-updated', { taskId: String(reward.taskId) }); return reward;
}

export async function listAdminRewards() { return TaskReward.find().populate('taskId', 'title').sort({ createdAt: -1 }).lean(); }
