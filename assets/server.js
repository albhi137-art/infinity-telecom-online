const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const processedRequests = new Map();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(__dirname));

function envConfig(){return {token:process.env.TELEGRAM_BOT_TOKEN,chatId:process.env.TELEGRAM_CHAT_ID}}
async function telegramCall(method, payload={}){
  const {token}=envConfig();
  if(!token)throw new Error("TELEGRAM_BOT_TOKEN সেট করা হয়নি।");
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),signal:controller.signal
    });
    const result=await response.json();
    if(!response.ok||!result.ok)throw new Error(result.description||"Telegram request failed");
    return result;
  }finally{clearTimeout(timer)}
}
async function sendText(text){
  const {chatId}=envConfig();
  if(!chatId)throw new Error("TELEGRAM_CHAT_ID সেট করা হয়নি।");
  return telegramCall("sendMessage",{chat_id:chatId,parse_mode:"HTML",text});
}

app.get("/api/status",async(_req,res)=>{
  try{await telegramCall("getMe");res.json({ok:true})}
  catch(error){res.status(503).json({ok:false,error:error.message||"Telegram offline"})}
});

app.post("/api/send", async (req, res) => {
  try {
    const { number, amount, service, message, requestId } = req.body || {};
    if (!/^01[3-9]\d{8}$/.test(String(number || ""))) return res.status(400).json({ok:false,error:"সঠিক মোবাইল নাম্বার দিন।"});
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return res.status(400).json({ok:false,error:"সঠিক Amount দিন।"});
    if (!String(service || "").trim() || !String(message || "").trim()) return res.status(400).json({ok:false,error:"অসম্পূর্ণ তথ্য।"});
    if(requestId&&processedRequests.has(requestId))return res.json({ok:true,duplicate:true});
    await sendText(message);
    if(requestId){processedRequests.set(requestId,Date.now());if(processedRequests.size>1000){const first=processedRequests.keys().next().value;processedRequests.delete(first)}}
    res.json({ ok: true });
  } catch (error) {console.error(error);res.status(500).json({ok:false,error:error.name==='AbortError'?"Telegram response timeout":error.message||"Server error"})}
});

app.post("/api/report",async(req,res)=>{
  try{
    const message=String(req.body?.message||"").trim();
    if(!message)return res.status(400).json({ok:false,error:"Report empty"});
    await sendText(message);res.json({ok:true});
  }catch(error){console.error(error);res.status(500).json({ok:false,error:error.message||"Report failed"})}
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.listen(PORT, () => console.log(`Infinity Telecom running on port ${PORT}`));
