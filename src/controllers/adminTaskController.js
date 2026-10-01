import {
  listAdminTasks, createTask, updateTask, archiveTask, listAdminSubmissions,
  reviewSubmission, moderateComment, listAdminComments, updateReward, listAdminRewards,
} from '../services/tasks/taskService.js';
import { findTaskProofImage } from '../services/tasks/taskMediaService.js';
export async function getAdminTasks(req,res,next){try{res.json({ok:true,data:await listAdminTasks()});}catch(e){next(e)}}
export async function postAdminTask(req,res,next){try{res.status(201).json({ok:true,data:await createTask(req.body)});}catch(e){next(e)}}
export async function patchAdminTask(req,res,next){try{res.json({ok:true,data:await updateTask(req.params.id,req.body)});}catch(e){next(e)}}
export async function deleteAdminTask(req,res,next){try{res.json({ok:true,data:await archiveTask(req.params.id)});}catch(e){next(e)}}
export async function getAdminSubmissions(req,res,next){try{res.json({ok:true,data:await listAdminSubmissions(req.query.status)});}catch(e){next(e)}}
export async function patchAdminSubmission(req,res,next){try{res.json({ok:true,data:await reviewSubmission(req.params.id,req.body)});}catch(e){next(e)}}
export async function getAdminComments(req,res,next){try{res.json({ok:true,data:await listAdminComments(req.query.taskId)});}catch(e){next(e)}}
export async function deleteAdminComment(req,res,next){try{res.json({ok:true,data:await moderateComment(req.params.id,req.body)});}catch(e){next(e)}}
export async function getAdminRewards(req,res,next){try{res.json({ok:true,data:await listAdminRewards()});}catch(e){next(e)}}
export async function patchAdminReward(req,res,next){try{res.json({ok:true,data:await updateReward(req.params.id,req.body)});}catch(e){next(e)}}
export async function getAdminProofImage(req,res,next){try{const media=await findTaskProofImage(req.params.id);if(!media)return res.status(404).json({ok:false,message:'Proof image was not found'});res.set({'Content-Type':media.file.contentType||'application/octet-stream','Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'});media.bucket.openDownloadStream(media.file._id).on('error',next).pipe(res);}catch(e){next(e)}}
