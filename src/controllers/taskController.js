import {
  listTasksForWallet, joinTask, submitTaskProof, listTaskComments, addTaskComment,
  toggleReaction, listWalletRewards, requireRegisteredWallet,
} from '../services/tasks/taskService.js';
import { storeTaskProofImage, findTaskProofImage } from '../services/tasks/taskMediaService.js';
import { addTaskLiveClient } from '../services/tasks/taskLiveService.js';

function wallet(req) { return req.walletSession.walletAddress; }
export async function getTasks(req,res,next){try{res.json({ok:true,data:await listTasksForWallet(wallet(req))});}catch(e){next(e)}}
export async function postJoin(req,res,next){try{res.status(201).json({ok:true,data:await joinTask(req.params.id,wallet(req))});}catch(e){next(e)}}
export async function postSubmission(req,res,next){try{res.status(201).json({ok:true,data:await submitTaskProof(req.params.id,wallet(req),req.body)});}catch(e){next(e)}}
export async function getComments(req,res,next){try{res.json({ok:true,data:await listTaskComments(req.params.id,wallet(req))});}catch(e){next(e)}}
export async function postComment(req,res,next){try{res.status(201).json({ok:true,data:await addTaskComment(req.params.id,wallet(req),req.body)});}catch(e){next(e)}}
export async function postReaction(req,res,next){try{res.json({ok:true,data:await toggleReaction(req.params.id,wallet(req),req.body)});}catch(e){next(e)}}
export async function getRewards(req,res,next){try{res.json({ok:true,data:await listWalletRewards(wallet(req))});}catch(e){next(e)}}
export async function uploadProofImage(req,res,next){try{const data=await storeTaskProofImage({buffer:req.body,contentType:String(req.headers['content-type']||'').split(';')[0],filename:req.headers['x-file-name'],walletAddress:await requireRegisteredWallet(wallet(req))});res.status(201).json({ok:true,data});}catch(e){next(e)}}
export async function getOwnProofImage(req,res,next){try{const media=await findTaskProofImage(req.params.id);if(!media||media.file.metadata?.walletAddress!==wallet(req))return res.status(404).json({ok:false,message:'Proof image was not found'});res.set({'Content-Type':media.file.contentType||'application/octet-stream','Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'});media.bucket.openDownloadStream(media.file._id).on('error',next).pipe(res);}catch(e){next(e)}}
export async function streamTaskEvents(req,res,next){try{await requireRegisteredWallet(wallet(req));res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders?.();res.write('event: ready\ndata: {"ok":true}\n\n');const remove=addTaskLiveClient(res);const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),25000);req.on('close',()=>{clearInterval(heartbeat);remove();});}catch(e){next(e)}}
