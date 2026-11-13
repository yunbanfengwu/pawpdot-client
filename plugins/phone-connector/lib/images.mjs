const maximum=600*1024;
function invalid(message){return Object.assign(new Error(message),{status:400,definitelyNotAccepted:true});}
export function imageMessage(input){
  if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['sessionId','requestId','text','images'].includes(k)))throw invalid('图片消息参数无效');
  for(const key of ['sessionId','requestId'])if(typeof input[key]!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(input[key]))throw invalid('会话或请求标识无效');
  const text=input.text??'';if(typeof text!=='string'||text.length>24000)throw invalid('消息文字过长');
  if(!Array.isArray(input.images)||input.images.length<1||input.images.length>3)throw invalid('每条消息请选择1至3张图片');
  const images=input.images.map(image=>{
    if(!image||typeof image.data!=='string'||image.data.length>Math.ceil(maximum/3)*4||!['image/png','image/jpeg'].includes(image.mediaType))throw invalid('图片过大或格式不支持');
    const bytes=Buffer.from(image.data,'base64');if(!bytes.length||bytes.length>maximum||bytes.toString('base64')!==image.data)throw invalid('图片数据无效');
    if(image.name!==undefined&&(typeof image.name!=='string'||!image.name.trim()||image.name.length>160||/[\x00-\x1f\\/]/.test(image.name)))throw invalid('图片名称无效');
    return {type:'image',data:image.data,mediaType:image.mediaType,...(image.name?{name:image.name}:{})};
  });
  return {sessionId:input.sessionId,requestId:input.requestId,content:[...(text.trim()?[{type:'text',text:text.trim()}]:[]),...images]};
}
export class MobileImageMessages {
  constructor({core,prompt}){this.core=core;this.prompt=prompt;}
  async send(device,input){
    this.core.harnessConfig(device);
    const request=imageMessage(input);
    await this.core.session(request.sessionId);
    try{
      return await this.core.command(device,request.sessionId,request.requestId,request.content,async()=>{
        const result=await this.prompt({...request,mode:'queue',clientTimeZone:'Asia/Shanghai'});
        return {accepted:result.accepted===true,sessionId:request.sessionId};
      });
    }catch(error){
      if(error.code==='session/attachment-invalid')throw invalid(error.details?.reason==='MODEL_DOES_NOT_SUPPORT_IMAGES'?'当前模型不支持图片，请切换支持识图的模型后发送':'图片未被接收，请重新选择有效图片');
      if(['session/model-unavailable','gateway/bad-request','session/not-found'].includes(error.code))throw invalid('当前会话或模型未就绪，请检查后发送');
      throw error;
    }
  }
}
