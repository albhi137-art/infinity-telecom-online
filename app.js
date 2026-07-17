import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, addDoc, getDocs,
  serverTimestamp, query, orderBy, increment
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";


const firebaseApp=initializeApp(firebaseConfig);
const auth=getAuth(firebaseApp);
const db=getFirestore(firebaseApp);

const numberInput=document.getElementById('numberInput');
const previewAmountInput=document.getElementById('previewAmountInput');
const amountInput=previewAmountInput;
const summaryAmountCard=document.getElementById('summaryAmountCard');
const summaryServiceCard=document.getElementById('summaryServiceCard');
const serviceChoiceMenu=document.getElementById('serviceChoiceMenu');
const suggestions=document.getElementById('suggestions');
const bigNumber=document.getElementById('bigNumber');
const statusEl=document.getElementById('status');
const groupEls=[
  document.getElementById('g1'),document.getElementById('g2'),
  document.getElementById('g3'),document.getElementById('g4'),
  document.getElementById('g5')
];

let selectedService='Mobile Recharge';
let historyList=[];
let transactionHistory=[];
let currentMatches=[];
let activeIndex=0;
let currentUser=null;

const loginOverlay=document.getElementById('loginOverlay');
const loginEmail=document.getElementById('loginEmail');
const loginPassword=document.getElementById('loginPassword');
const loginMessage=document.getElementById('loginMessage');
const loginSubmit=document.getElementById('loginSubmit');
const registerSubmit=document.getElementById('registerSubmit');
const cloudSync=document.getElementById('cloudSync');

const themeButton=document.getElementById('themeButton');
const customerSummary=document.getElementById('customerSummary');
const onlineBadge=document.querySelector('.onlineBadge');
const OFFLINE_QUEUE_KEY='infinityOfflineQueueV5';

function applyTheme(theme){
  const isLight=theme==='light';
  document.body.classList.toggle('light-theme',isLight);
  themeButton.textContent=isLight?'🌙 Dark':'☀️ Light';
  themeButton.setAttribute('aria-label',isLight?'Dark theme চালু করুন':'Light theme চালু করুন');
}

applyTheme(localStorage.getItem('infinityTheme')||'dark');

themeButton.addEventListener('click',()=>{
  const nextTheme=document.body.classList.contains('light-theme')?'dark':'light';
  localStorage.setItem('infinityTheme',nextTheme);
  applyTheme(nextTheme);
});


function setCloud(text,state='ok'){
  cloudSync.textContent=text;
  cloudSync.className='cloudSync'+(state==='busy'?' busy':state==='error'?' error':'');
}
function friendlyAuthError(error){
  const code=error?.code||'';
  if(code.includes('invalid-credential'))return 'ইমেইল অথবা পাসওয়ার্ড ভুল।';
  if(code.includes('email-already-in-use'))return 'এই ইমেইলে আগে থেকেই অ্যাকাউন্ট আছে। Login করুন।';
  if(code.includes('weak-password'))return 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন।';
  if(code.includes('invalid-email'))return 'সঠিক ইমেইল লিখুন।';
  if(code.includes('too-many-requests'))return 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।';
  return error?.message||'কাজটি করা যায়নি।';
}
async function handleLogin(create=false){
  const email=loginEmail.value.trim();
  const password=loginPassword.value;
  if(!email||!password){loginMessage.textContent='ইমেইল ও পাসওয়ার্ড লিখুন।';return}
  loginSubmit.disabled=registerSubmit.disabled=true;
  loginMessage.style.color='#93c5fd';
  loginMessage.textContent=create?'অ্যাকাউন্ট তৈরি হচ্ছে...':'Login হচ্ছে...';
  try{
    if(create) await createUserWithEmailAndPassword(auth,email,password);
    else await signInWithEmailAndPassword(auth,email,password);
  }catch(e){
    loginMessage.style.color='#fca5a5';
    loginMessage.textContent=friendlyAuthError(e);
  }finally{
    loginSubmit.disabled=registerSubmit.disabled=false;
  }
}
loginSubmit.addEventListener('click',()=>handleLogin(false));
registerSubmit.addEventListener('click',()=>handleLogin(true));
loginPassword.addEventListener('keydown',e=>{if(e.key==='Enter')handleLogin(false)});
document.getElementById('logoutButton').addEventListener('click',()=>signOut(auth));

onAuthStateChanged(auth,async user=>{
  currentUser=user;
  if(!user){
    loginOverlay.classList.remove('hidden');
    document.getElementById('userArea').classList.remove('show');
    historyList=[]; transactionHistory=[];
    return;
  }
  loginOverlay.classList.add('hidden');
  loginMessage.textContent='';
  document.getElementById('userEmail').textContent=user.email||'Logged in';
  document.getElementById('userArea').classList.add('show');
  setCloud('☁️ ডাটা লোড হচ্ছে','busy');
  await loadCloudData();
  await migrateLocalDataOnce();
  setCloud('☁️ Cloud Synced');
  numberInput.focus();
});

async function loadCloudData(){
  if(!currentUser)return;
  try{
    const customersSnap=await getDocs(collection(db,'users',currentUser.uid,'customers'));
    historyList=customersSnap.docs
      .map(d=>d.data())
      .sort((a,b)=>(b.visitCount||0)-(a.visitCount||0))
      .map(x=>x.number)
      .filter(Boolean);

    let transSnap;
    try{
      transSnap=await getDocs(query(
        collection(db,'users',currentUser.uid,'transactions'),
        orderBy('createdAt','desc')
      ));
    }catch{
      transSnap=await getDocs(collection(db,'users',currentUser.uid,'transactions'));
    }
    transactionHistory=transSnap.docs.map(d=>{
      const x=d.data();
      return {
        id:d.id, number:x.number, amount:Number(x.amount||0),
        service:x.service||'Unknown', operator:x.operator||detectOperator(x.number||''),
        timestamp:x.createdAt?.toDate?.().toISOString()||x.timestamp||new Date(0).toISOString()
      };
    }).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
    renderDashboard();
    updateCustomerSummary();
    await sendPendingDailyReport();
    processOfflineQueue();
  }catch(e){
    console.error(e);
    setCloud('☁️ Sync Error','error');
    setStatus('Firebase ডাটা লোড করা যায়নি: '+e.message,false);
  }
}

async function migrateLocalDataOnce(){
  if(!currentUser)return;
  const key='firebaseMigrated_'+currentUser.uid;
  if(localStorage.getItem(key)==='yes')return;

  const localNumbers=JSON.parse(localStorage.getItem('customerNumbers')||'[]');
  const localTransactions=JSON.parse(localStorage.getItem('transactionHistory')||'[]');
  if(!localNumbers.length&&!localTransactions.length){
    localStorage.setItem(key,'yes'); return;
  }
  setCloud('☁️ পুরোনো ডাটা আপলোড হচ্ছে','busy');
  try{
    for(const n of localNumbers){
      if(validNumber(n)){
        await setDoc(doc(db,'users',currentUser.uid,'customers',n),{
          number:n,visitCount:1,lastUsedAt:serverTimestamp()
        },{merge:true});
      }
    }
    for(const x of localTransactions){
      if(validNumber(x.number)){
        await addDoc(collection(db,'users',currentUser.uid,'transactions'),{
          number:x.number,amount:Number(x.amount||0),service:x.service||'Unknown',
          operator:x.operator||detectOperator(x.number),
          timestamp:x.timestamp||new Date().toISOString(),
          createdAt:serverTimestamp()
        });
      }
    }
    localStorage.setItem(key,'yes');
    await loadCloudData();
  }catch(e){console.error(e)}
}

function validNumber(n){return /^01[3-9]\d{8}$/.test(n)}
function updatePreview(){
  const v=numberInput.value.replace(/\D/g,'').slice(0,11);
  numberInput.value=v;
  bigNumber.textContent=v||'01XXXXXXXXX';
  const p=[v.slice(0,3),v.slice(3,5),v.slice(5,7),v.slice(7,9),v.slice(9,11)];
  groupEls.forEach((e,i)=>e.textContent=p[i]);
  updateSuggestions();
  updateCustomerSummary();
}
function updateSuggestions(){
  const q=numberInput.value;
  if(q.length<2){hideSuggestions();return}
  currentMatches=historyList
    .filter(n=>n!==q&&n.includes(q))
    .sort((a,b)=>Number(b.startsWith(q))-Number(a.startsWith(q)) || a.localeCompare(b));
  if(!currentMatches.length){hideSuggestions();return}
  activeIndex=0;
  suggestions.innerHTML=currentMatches.slice(0,15).map((n,i)=>{
    const rows=transactionHistory.filter(x=>x.number===n);
    const last=rows[0];
    const meta=last?`শেষ ৳${Number(last.amount||0).toLocaleString('en-BD')} • ${rows.length} বার`:'Saved number';
    return `<button class="suggestion${i===0?' active':''}" data-number="${n}"><span><strong>${n}</strong><small>${meta}</small></span><span>Enter</span></button>`;
  }).join('');
  suggestions.classList.add('show');
}
function hideSuggestions(){suggestions.classList.remove('show');suggestions.innerHTML='';currentMatches=[]}
function chooseNumber(n){numberInput.value=n;updatePreview();hideSuggestions();numberInput.focus()}
suggestions.addEventListener('click',e=>{const b=e.target.closest('.suggestion');if(b)chooseNumber(b.dataset.number)});
numberInput.addEventListener('input',updatePreview);
numberInput.addEventListener('keydown',e=>{
  if(e.key==='ArrowDown'&&currentMatches.length){e.preventDefault();activeIndex=(activeIndex+1)%currentMatches.length;paintActive()}
  else if(e.key==='ArrowUp'&&currentMatches.length){e.preventDefault();activeIndex=(activeIndex-1+currentMatches.length)%currentMatches.length;paintActive()}
  else if(e.key==='Enter'){
    e.preventDefault();
    const n=numberInput.value.replace(/\D/g,'');
    if(n.length===11){hideSuggestions();send()}
  }
  else if(e.key==='Escape'){numberInput.value='';updatePreview();hideSuggestions()}
});
function paintActive(){[...suggestions.children].forEach((x,i)=>x.classList.toggle('active',i===activeIndex))}

function cleanAmount(value){
  let cleaned=String(value||'').replace(/[^0-9.]/g,'');
  const firstDot=cleaned.indexOf('.');
  if(firstDot!==-1) cleaned=cleaned.slice(0,firstDot+1)+cleaned.slice(firstDot+1).replace(/\./g,'');
  return cleaned.slice(0,10);
}
function setAmount(value){
  const cleaned=cleanAmount(value);
  previewAmountInput.value=cleaned;
  applyAmountColor(Number(cleaned||0));
}
function applyAmountColor(amount){
  if(!summaryAmountCard)return;
  summaryAmountCard.classList.remove('amount-blue','amount-green','amount-purple','amount-orange','amount-pink','amount-custom');
  const cls=amount===50?'amount-blue':amount===100?'amount-green':amount===150?'amount-purple':amount===200?'amount-orange':amount===500?'amount-pink':amount>0?'amount-custom':'';
  if(cls)summaryAmountCard.classList.add(cls);
}
previewAmountInput.addEventListener('input',()=>setAmount(previewAmountInput.value));
previewAmountInput.addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    e.preventDefault();
    const n=numberInput.value.replace(/\D/g,'');
    if(n.length===11) send(); else { setStatus('সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন',false); numberInput.focus(); }
  }
  if(e.key==='Escape'){previewAmountInput.value='';numberInput.focus()}
});
function closeSummaryMenus(){
  serviceChoiceMenu?.classList.remove('show');
  summaryServiceCard?.setAttribute('aria-expanded','false');
}
function toggleServiceMenu(){
  const willOpen=!serviceChoiceMenu.classList.contains('show');
  closeSummaryMenus();
  if(willOpen){serviceChoiceMenu.classList.add('show');summaryServiceCard.setAttribute('aria-expanded','true')}
}
summaryServiceCard?.addEventListener('click',e=>{
  if(e.target.closest('[data-preview-service]'))return;
  toggleServiceMenu();
});
summaryServiceCard?.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleServiceMenu()}});
serviceChoiceMenu?.addEventListener('click',e=>{
  const b=e.target.closest('[data-preview-service]');if(!b)return;
  selectedService=b.dataset.previewService;
  document.getElementById('selectedService').textContent=selectedService;
  closeSummaryMenus();numberInput.focus();
});
document.addEventListener('click',e=>{if(!e.target.closest('#summaryServiceCard'))closeSummaryMenus()});
function updateAmount(){setAmount(previewAmountInput.value)}


function relativeTime(iso){
  if(!iso)return '—';
  const diff=Math.max(0,Date.now()-new Date(iso).getTime());
  const min=Math.floor(diff/60000);
  if(min<1)return 'এইমাত্র';
  if(min<60)return `${min} মিনিট আগে`;
  const hour=Math.floor(min/60);if(hour<24)return `${hour} ঘণ্টা আগে`;
  return `${Math.floor(hour/24)} দিন আগে`;
}
function updateCustomerSummary(){
  if(!customerSummary)return;
  const n=numberInput.value.replace(/\D/g,'');
  const rows=n.length>=3?transactionHistory.filter(x=>x.number===n).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)):[];
  customerSummary.classList.toggle('show',rows.length>0);
  if(!rows.length)return;
  const last=rows[0];
  document.getElementById('summaryVisits').textContent=rows.length+' বার';
  document.getElementById('summaryLastAmount').textContent=formatMoney(last.amount);
  document.getElementById('summaryLastService').textContent=last.service||'—';
  document.getElementById('summaryLastTime').textContent=relativeTime(last.timestamp);
}

async function saveTransaction(number,amount,service){
  if(!currentUser)throw new Error('আগে Login করুন');
  const item={
    number,amount:Number(amount),service,operator:detectOperator(number),
    timestamp:new Date().toISOString(),createdAt:serverTimestamp()
  };
  setCloud('☁️ সেভ হচ্ছে','busy');
  await Promise.all([
    addDoc(collection(db,'users',currentUser.uid,'transactions'),item),
    setDoc(doc(db,'users',currentUser.uid,'customers',number),{
      number,lastService:service,lastAmount:Number(amount),visitCount:increment(1),
      lastUsedAt:serverTimestamp(),updatedAt:serverTimestamp()
    },{merge:true})
  ]);
  transactionHistory.unshift({...item,id:String(Date.now())});
  historyList=[number,...historyList.filter(x=>x!==number)];
  renderDashboard();
  setCloud('☁️ Cloud Sync: Active');
}

const historyOverlay=document.getElementById('historyOverlay');
const historySearch=document.getElementById('historySearch');
const historyEmpty=document.getElementById('historyEmpty');
const historyResult=document.getElementById('historyResult');
const historyListEl=document.getElementById('historyList');

function openHistory(){
  historyOverlay.classList.add('show');
  historySearch.value='';
  renderCustomerHistory();
  setTimeout(()=>historySearch.focus(),80);
}
function closeHistory(){historyOverlay.classList.remove('show')}
function formatHistoryDate(iso){
  const d=new Date(iso);
  if(Number.isNaN(d.getTime()))return '—';
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})+' '+
    d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
}
function transactionLogo(service,operator){
  const text=String(service||operator||'').toLowerCase();
  if(text.includes('bkash'))return 'b';
  if(text.includes('nagad'))return 'N';
  if(text.includes('rocket'))return 'R';
  if(text.includes('grameen')||text.includes('gp'))return 'GP';
  if(text.includes('robi'))return 'R';
  if(text.includes('airtel'))return 'A';
  if(text.includes('banglalink'))return 'BL';
  if(text.includes('teletalk'))return 'T';
  return '৳';
}
function transactionLogoClass(service,operator){
  const text=String(service||operator||'').toLowerCase();
  if(text.includes('bkash'))return 'bkash';
  if(text.includes('nagad'))return 'nagad';
  if(text.includes('rocket'))return 'rocket';
  if(text.includes('airtel'))return 'airtel';
  if(text.includes('banglalink'))return 'banglalink';
  if(text.includes('grameen')||text.includes('gp'))return 'gp';
  if(text.includes('robi'))return 'robi';
  if(text.includes('teletalk'))return 'teletalk';
  return 'recharge';
}
function renderCustomerHistory(){
  const q=historySearch.value.replace(/\D/g,'').slice(0,11);
  historySearch.value=q;
  const rows=transactionHistory
    .filter(x=>!q||String(x.number||'').includes(q))
    .sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
  const total=rows.reduce((sum,x)=>sum+Number(x.amount||0),0);
  document.getElementById('historyCount').textContent=rows.length.toLocaleString('en-BD');
  document.getElementById('historyTotal').textContent='৳'+total.toLocaleString('en-BD');
  if(!rows.length){
    historyListEl.innerHTML='';
    historyResult.classList.remove('show');
    historyEmpty.style.display='flex';
    historyEmpty.textContent=q?'এই নাম্বারের কোনো সফল লেনদেন পাওয়া যায়নি।':'কোনো সফল লেনদেন পাওয়া যায়নি।';
    return;
  }
  historyListEl.innerHTML=rows.map(x=>`
    <article class="recentTransactionCard">
      <div class="transactionIdentity">
        <div class="transactionLogo ${transactionLogoClass(x.service,x.operator)}">${transactionLogo(x.service,x.operator)}</div>
        <div class="transactionMain">
          <strong class="transactionNumber">${x.number||'—'}</strong>
          <span class="transactionType">${x.service||'Mobile Recharge'}</span>
          <small class="transactionOperator">${x.operator||'Prepaid'}</small>
        </div>
      </div>
      <div class="transactionDetails">
        <div class="transactionAmount">TK ${Number(x.amount||0).toLocaleString('en-BD')}</div>
        <time>${formatHistoryDate(x.timestamp)}</time>
        <span class="transactionSuccess">Success</span>
      </div>
    </article>`).join('');
  historyEmpty.style.display='none';
  historyResult.classList.add('show');
}


const customersOverlay=document.getElementById('customersOverlay');
const customersSearch=document.getElementById('customersSearch');
const customersListEl=document.getElementById('customersList');
const customersCount=document.getElementById('customersCount');

function customerRows(){
  const map=new Map();
  for(const x of transactionHistory){
    if(!x.number) continue;
    const old=map.get(x.number)||{number:x.number,count:0,total:0,last:null,lastAmount:0,lastService:'—'};
    old.count+=1;
    old.total+=Number(x.amount||0);
    if(!old.last || new Date(x.timestamp)>new Date(old.last)){
      old.last=x.timestamp; old.lastAmount=Number(x.amount||0); old.lastService=x.service||'—';
    }
    map.set(x.number,old);
  }
  for(const n of historyList){
    if(!map.has(n)) map.set(n,{number:n,count:0,total:0,last:null,lastAmount:0,lastService:'—'});
  }
  return [...map.values()].sort((a,b)=>{
    const ad=a.last?new Date(a.last).getTime():0, bd=b.last?new Date(b.last).getTime():0;
    return bd-ad || b.count-a.count;
  });
}
function formatCustomerLast(iso){
  if(!iso)return 'কোনো সময় নেই';
  const d=new Date(iso);
  return d.toLocaleDateString('en-GB')+' • '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
}
function renderAllCustomers(){
  const q=customersSearch.value.replace(/\D/g,'').slice(0,11);
  customersSearch.value=q;
  const rows=customerRows().filter(x=>!q||x.number.includes(q));
  customersCount.textContent=rows.length+' customer';
  if(!rows.length){customersListEl.innerHTML='<div class="historyNoMatch">কোনো নাম্বার পাওয়া যায়নি।</div>';return}
  customersListEl.innerHTML=rows.map(x=>`
    <button class="customerCard" data-number="${x.number}" data-amount="${x.lastAmount||''}">
      <div class="customerPhone">${x.number}</div>
      <div class="customerAmount">৳${Number(x.lastAmount||0).toLocaleString('en-BD')}</div>
      <div class="customerMeta">${x.lastService} • ${x.count} বার</div>
      <div class="customerTime">${formatCustomerLast(x.last)}</div>
      <div class="customerUse">ক্লিক করলে নাম্বার বসবে</div>
    </button>`).join('');
}
function openCustomers(){
  customersOverlay.classList.add('show');
  customersSearch.value='';
  renderAllCustomers();
  setTimeout(()=>customersSearch.focus(),80);
}
function closeCustomers(){customersOverlay.classList.remove('show')}
document.getElementById('customersButton').addEventListener('click',openCustomers);
document.getElementById('customersClose').addEventListener('click',closeCustomers);
customersOverlay.addEventListener('click',e=>{if(e.target===customersOverlay)closeCustomers()});
customersSearch.addEventListener('input',renderAllCustomers);
customersListEl.addEventListener('click',e=>{
  const card=e.target.closest('.customerCard'); if(!card)return;
  numberInput.value=card.dataset.number;
  if(card.dataset.amount) setAmount(card.dataset.amount);
  updatePreview(); updateAmount(); closeCustomers(); numberInput.focus();
});

document.getElementById('historyButton').addEventListener('click',openHistory);
document.getElementById('historyClose').addEventListener('click',closeHistory);
historyOverlay.addEventListener('click',e=>{if(e.target===historyOverlay)closeHistory()});
historySearch.addEventListener('input',renderCustomerHistory);

function detectOperator(n){
  const p=n.slice(0,3);
  if(['013','017'].includes(p))return 'Grameenphone';
  if(['014','019'].includes(p))return 'Banglalink';
  if(p==='015')return 'Teletalk';
  if(p==='016')return 'Airtel';
  if(p==='018')return 'Robi';
  return 'Unknown';
}
function showSuccessPopup(n,amount,service){
  document.getElementById('successNumber').textContent=n;
  document.getElementById('successAmount').textContent='৳'+amount;
  document.getElementById('successGateway').textContent=service;
  document.getElementById('successOverlay').classList.add('show');
  document.getElementById('successDone').focus();
}
function closeSuccessPopup(){
  document.getElementById('successOverlay').classList.remove('show');
  numberInput.value='';setAmount('');
  updatePreview();updateAmount();setStatus('',true);numberInput.focus();
}
document.getElementById('successDone').addEventListener('click',closeSuccessPopup);
document.getElementById('successOverlay').addEventListener('click',e=>{if(e.target.id==='successOverlay')closeSuccessPopup()});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&customersOverlay.classList.contains('show')){closeCustomers();return}
  if(e.key==='Escape'&&historyOverlay.classList.contains('show')){closeHistory();return}
  if(e.key==='Escape'&&document.getElementById('successOverlay').classList.contains('show'))closeSuccessPopup();
});

function messageText(n){
  const d=new Date();
  return `📱 Customer Number\n\n<code>${n}</code>\n\n💵 Amount: ৳${amountInput.value||'0'}\n💳 Gateway: ${selectedService}\n\n📅 Date: ${d.toLocaleDateString('en-GB')}\n⏰ Time: ${d.toLocaleTimeString('en-GB',{hour12:false})}`;
}
let isSending=false;
function queueItems(){try{return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY)||'[]')}catch{return []}}
function saveQueue(items){localStorage.setItem(OFFLINE_QUEUE_KEY,JSON.stringify(items))}
function createPayload(n,amount,service){return {requestId:`${Date.now()}-${Math.random().toString(36).slice(2)}`,number:n,amount:Number(amount),service,message:messageText(n),queuedAt:new Date().toISOString()}}
function addToOfflineQueue(payload){const items=queueItems();items.push(payload);saveQueue(items)}
async function postTelegram(payload){
  const r=await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data.ok)throw new Error(data.error||'Telegram send failed');
  return data;
}
async function processOfflineQueue(){
  if(!navigator.onLine||isSending||!currentUser)return;
  const items=queueItems();if(!items.length)return;
  setStatus(`${items.length}টি অপেক্ষমাণ লেনদেন পাঠানো হচ্ছে...`,true);
  const remaining=[];
  for(const item of items){
    try{await postTelegram(item);await saveTransaction(item.number,item.amount,item.service)}
    catch(e){remaining.push(item);console.error('Queue retry failed',e)}
  }
  saveQueue(remaining);
  if(!remaining.length)setStatus('সব অপেক্ষমাণ লেনদেন পাঠানো হয়েছে',true);
}
async function send(){
  if(isSending)return;
  if(!currentUser){setStatus('আগে Login করুন',false);return}
  const n=numberInput.value.replace(/\D/g,'');
  const amount=((amountInput.value||'').trim()||'0');
  if(!validNumber(n)){setStatus('সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন',false);numberInput.focus();return}
  if(!amount || Number(amount)<=0){setStatus('Amount লিখুন',false);previewAmountInput.focus();return}
  const payload=createPayload(n,amount,selectedService);
  if(!navigator.onLine){
    addToOfflineQueue(payload);setStatus('ইন্টারনেট নেই—Queue-তে সেভ হয়েছে',true);showSuccessPopup(n,amount,selectedService);return;
  }
  isSending=true;numberInput.disabled=true;previewAmountInput.disabled=true;setStatus(`${selectedService} পাঠানো হচ্ছে...`,true);
  try{
    await postTelegram(payload);
    await saveTransaction(n,amount,selectedService);
    setStatus(`${selectedService} সফলভাবে পাঠানো হয়েছে`,true);
    showSuccessPopup(n,amount,selectedService);
  }catch(err){
    console.error(err);
    const networkLike=!navigator.onLine||/fetch|network|timeout|failed/i.test(err.message||'');
    if(networkLike){addToOfflineQueue(payload);setStatus('সার্ভার পাওয়া যায়নি—Queue-তে সেভ হয়েছে',true);showSuccessPopup(n,amount,selectedService)}
    else{setCloud('☁️ Sync Error','error');setStatus(location.protocol==='file:'?'ফাইল ডাবল-ক্লিক নয়—Render link দিয়ে চালান':err.message,false)}
  }finally{isSending=false;numberInput.disabled=false;previewAmountInput.disabled=false}
}
function setStatus(t,ok){statusEl.textContent=t;statusEl.style.color=ok?'#43d679':'#ff5b5b'}
window.addEventListener('online',()=>{document.getElementById('offline').classList.remove('show');checkTelegramStatus();processOfflineQueue()});
window.addEventListener('offline',()=>document.getElementById('offline').classList.add('show'));
if(!navigator.onLine)document.getElementById('offline').classList.add('show');
updatePreview();updateAmount();


function formatMoney(v){return '৳'+Number(v||0).toLocaleString('en-US')}
function sameDay(a,b){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()}
function renderDashboard(){
  const tx=transactionHistory||[];
  const unique=[...new Set(tx.map(x=>x.number).filter(Boolean))];
  const total=tx.reduce((s,x)=>s+Number(x.amount||0),0);
  const now=new Date();
  const todayRows=tx.filter(x=>sameDay(new Date(x.timestamp),now));
  const today=todayRows.reduce((s,x)=>s+Number(x.amount||0),0);
  const set=(id,val)=>{const e=document.getElementById(id);if(e)e.textContent=val};
  set('statNumbers',historyList.length.toLocaleString('en-US'));
  set('statCustomers',unique.length.toLocaleString('en-US'));
  set('statRecharge',formatMoney(total)); set('statToday',formatMoney(today)); set('statTodayCount',todayRows.length+' টি লেনদেন');
  const recent=document.getElementById('recentHistoryList');
  if(recent) recent.innerHTML=tx.slice(0,4).map(x=>`<div class="miniRow"><strong>${x.number}</strong><span>${x.service}</span><em>${formatMoney(x.amount)}</em></div>`).join('')||'<div class="emptyMini">No recharge history yet</div>';
  const counts={};
  tx.forEach(x=>{const c=counts[x.number]||(counts[x.number]={count:0,total:0});c.count++;c.total+=Number(x.amount||0)});
  const top=Object.entries(counts).sort((a,b)=>b[1].count-a[1].count).slice(0,4);
  const topEl=document.getElementById('topCustomersList');
  if(topEl) topEl.innerHTML=top.map(([n,v])=>`<div class="miniRow"><strong>${n}</strong><span>${v.count} Times</span><em>${formatMoney(v.total)}</em></div>`).join('')||'<div class="emptyMini">No customer data yet</div>';
  const sums={}; tx.forEach(x=>{const k=x.service||'Unknown';const s=sums[k]||(sums[k]={count:0,total:0});s.count++;s.total+=Number(x.amount||0)});
  const sumEl=document.getElementById('serviceSummaryList');
  if(sumEl) sumEl.innerHTML=Object.entries(sums).slice(0,4).map(([k,v])=>`<div class="miniRow"><strong>${k}</strong><span>${formatMoney(v.total)}</span><em>${v.count}</em></div>`).join('')||'<div class="emptyMini">No service data yet</div>';
}
function tickDateTime(){const e=document.getElementById('currentDateTime');if(e)e.textContent=new Date().toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}
setInterval(tickDateTime,1000);tickDateTime();
const globalSearch=document.getElementById('globalSearch');
document.getElementById('recentViewAll')?.addEventListener('click',openHistory);
document.getElementById('topViewAll')?.addEventListener('click',openCustomers);


/* Selected smart functions only — original UI preserved */
async function checkTelegramStatus(){
  if(!onlineBadge)return;
  onlineBadge.textContent='● CHECKING';
  try{
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);
    const r=await fetch('/api/status',{cache:'no-store',signal:controller.signal});clearTimeout(timer);
    const data=await r.json();if(!r.ok||!data.ok)throw new Error('Offline');
    onlineBadge.textContent='● TELEGRAM ONLINE';onlineBadge.classList.remove('telegramOffline');
  }catch{onlineBadge.textContent='● TELEGRAM OFFLINE';onlineBadge.classList.add('telegramOffline')}
}
function localDateKey(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function reportForDate(date){
  const rows=transactionHistory.filter(x=>sameDay(new Date(x.timestamp),date));
  const total=rows.reduce((s,x)=>s+Number(x.amount||0),0);const service={};
  rows.forEach(x=>{const k=x.service||'Unknown';service[k]=(service[k]||0)+1});
  const lines=Object.entries(service).map(([k,v])=>`${k}: ${v}`).join('\n')||'কোনো লেনদেন নেই';
  return {message:`📊 Infinity Telecom Daily Report\n\n📅 Date: ${date.toLocaleDateString('en-GB')}\n🧾 Total Transactions: ${rows.length}\n💰 Total Amount: ৳${total.toLocaleString('en-BD')}\n\n${lines}`};
}
async function sendPendingDailyReport(){
  if(!currentUser||!navigator.onLine)return;
  const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);yesterday.setHours(12,0,0,0);
  const key=`dailyReport_${currentUser.uid}_${localDateKey(yesterday)}`;
  if(localStorage.getItem(key)==='sent')return;
  try{
    const r=await fetch('/api/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(reportForDate(yesterday))});
    const data=await r.json();if(!r.ok||!data.ok)throw new Error(data.error||'Report failed');
    localStorage.setItem(key,'sent');
  }catch(e){console.error('Daily report pending',e)}
}
function msUntilNextMidnight(){const now=new Date(),next=new Date(now);next.setHours(24,0,5,0);return next-now}
setTimeout(()=>{sendPendingDailyReport();setInterval(sendPendingDailyReport,24*60*60*1000)},msUntilNextMidnight());

document.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==='F2'){e.preventDefault();numberInput.focus();numberInput.select()}
  if(e.key==='F3'){e.preventDefault();previewAmountInput.focus();previewAmountInput.select()}
  if(e.key==='F4'){e.preventDefault();toggleServiceMenu()}
  if(serviceChoiceMenu?.classList.contains('show')&&['1','2','3','4'].includes(e.key)){
    e.preventDefault();serviceChoiceMenu.querySelectorAll('[data-preview-service]')[Number(e.key)-1]?.click();
  }
});
checkTelegramStatus();setInterval(checkTelegramStatus,45000);
