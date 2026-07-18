import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, addDoc, getDocs,
  serverTimestamp, query, orderBy, increment, deleteDoc
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
let customerProfiles=new Map();

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
refreshSelectedServiceIcons();

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
    const customerDocs=customersSnap.docs.map(d=>({id:d.id,...d.data()}));
    customerProfiles=new Map(customerDocs.filter(x=>x.number).map(x=>[x.number,x]));
    historyList=customerDocs
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
  suggestions.innerHTML=currentMatches.map((n,i)=>{
    const rows=transactionHistory.filter(x=>x.number===n);
    const last=rows[0];
    const operator=last?.operator||detectOperator(n);
    const profile=customerProfiles.get(n)||{};
    const name=String(profile.name||'').trim();
    const meta=last?`শেষ ৳${Number(last.amount||0).toLocaleString('en-BD')} • ${rows.length} বার`:'Saved number';
    return `<button class="suggestion${i===0?' active':''}" data-number="${n}"><div class="suggestionIdentity"><div class="suggestionLogo">${brandSvg(last?.service||'Mobile Recharge',operator)}</div><div class="suggestionText">${name?`<span class="suggestionCustomerName">${escapeHtml(name)}</span>`:''}<strong>${n}</strong><small>${meta}</small></div></div><span class="suggestionEnter">Enter</span></button>`;
  }).join('');
  suggestions.classList.add('show');
}
function hideSuggestions(){suggestions.classList.remove('show');suggestions.innerHTML='';currentMatches=[]}
function chooseNumber(n){numberInput.value=n;updatePreview();hideSuggestions();numberInput.focus()}
suggestions.addEventListener('click',e=>{const b=e.target.closest('.suggestion');if(b)chooseNumber(b.dataset.number)});
numberInput.addEventListener('input',updatePreview);
numberInput.addEventListener('keydown',e=>{
  const visibleMatches=currentMatches;
  const serviceShortcuts={m:'Mobile Recharge',r:'Rocket',b:'bKash',n:'Nagad'};
  const shortcutService=serviceShortcuts[String(e.key||'').toLowerCase()];
  const typedNumber=numberInput.value.replace(/\D/g,'');
  if(shortcutService&&typedNumber.length>0){
    e.preventDefault();
    selectService(shortcutService);
    setStatus(`${shortcutService} নির্বাচন করা হয়েছে`,true);
    return;
  }
  if(e.key==='ArrowDown'&&visibleMatches.length){e.preventDefault();activeIndex=Math.min(activeIndex+1,visibleMatches.length-1);paintActive()}
  else if(e.key==='ArrowUp'&&visibleMatches.length){e.preventDefault();activeIndex=Math.max(activeIndex-1,0);paintActive()}
  else if(e.key==='Enter'){
    e.preventDefault();

    // Suggestion দেখা গেলে Enter চাপলে active number-টি আগে select হবে।
    if(suggestions.classList.contains('show')&&visibleMatches.length){
      chooseNumber(visibleMatches[activeIndex]||visibleMatches[0]);
      return;
    }

    const n=numberInput.value.replace(/\D/g,'');
    if(n.length===11){hideSuggestions();send()}
  }
  else if(e.key==='Escape'){numberInput.value='';updatePreview();hideSuggestions()}
});
function paintActive(){const items=[...suggestions.children];items.forEach((x,i)=>x.classList.toggle('active',i===activeIndex));items[activeIndex]?.scrollIntoView({block:'nearest',behavior:'smooth'})}

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
function selectService(service){
  selectedService=service;
  const selectedServiceEl=document.getElementById('selectedService');
  if(selectedServiceEl)selectedServiceEl.textContent=selectedService;
  refreshSelectedServiceIcons();
  closeSummaryMenus();
}
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
  selectService(b.dataset.previewService);
  numberInput.focus();
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
  customerProfiles.set(number,{...(customerProfiles.get(number)||{}),number,lastService:service,lastAmount:Number(amount)});
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
    d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function serviceIconSrc(service){
  const text=String(service||'').toLowerCase();
  if(text.includes('bkash'))return './assets/bkash.png';
  if(text.includes('nagad'))return './assets/nagad.png';
  if(text.includes('rocket'))return './assets/rocket.png';
  return './assets/mobile-recharge.png';
}
function serviceIconHtml(service,extraClass=''){
  const safe=String(service||'Mobile Recharge').replace(/"/g,'&quot;');
  return `<img class="serviceBrandIcon ${extraClass}" src="${serviceIconSrc(service)}" alt="${safe}" loading="lazy">`;
}
function refreshSelectedServiceIcons(){
  const inputIcon=document.getElementById('selectedServiceInputIcon');
  const previewIcon=document.getElementById('selectedServicePreviewIcon');
  if(inputIcon)inputIcon.innerHTML=serviceIconHtml(selectedService,'inputServiceIcon');
  if(previewIcon)previewIcon.innerHTML=serviceIconHtml(selectedService,'previewServiceIcon');
}
function brandSvg(service,operator){
  const text=String(service||operator||'').toLowerCase();
  const svg=(body,label)=>`<svg class="brandSvg" viewBox="0 0 48 48" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  if(text.includes('bkash'))return serviceIconHtml('bKash');
  if(text.includes('nagad'))return serviceIconHtml('Nagad');
  if(text.includes('rocket'))return serviceIconHtml('Rocket');
  if(text.includes('mobile recharge')||text.includes('recharge'))return serviceIconHtml('Mobile Recharge');
  if(text.includes('grameen')||text.includes('gp'))return svg('<path fill="#16A4E0" d="M24 4c5 0 9 4 9 9 0 3-1 5-3 7 6 1 11 6 11 12 0 7-6 12-13 12-5 0-10-3-12-8-2 2-4 3-7 3-5 0-9-4-9-9 0-6 5-10 11-10h2c-1-2-1-4-1-6 0-6 5-10 12-10Z"/><circle cx="24" cy="24" r="6" fill="#fff"/>','Grameenphone');
  if(text.includes('robi'))return svg('<circle cx="24" cy="24" r="21" fill="#E8242F"/><path fill="#fff" d="M12 31c4-11 12-17 25-17-8 4-13 9-16 16 5-3 10-4 15-3-6 6-15 8-24 4Z"/>','Robi');
  if(text.includes('airtel'))return svg('<circle cx="24" cy="24" r="21" fill="#E51C23"/><path fill="#fff" d="M13 28c8-2 13-7 15-15 5 7 6 14 2 20-5 6-12 5-17-5Z"/>','Airtel');
  if(text.includes('banglalink'))return svg('<rect x="5" y="5" width="38" height="38" rx="12" fill="#FF6B16"/><path fill="#fff" d="M15 34V14h9c7 0 11 3 11 8 0 3-2 5-5 6 4 1 6 3 6 6H15Zm6-12h4c3 0 4-1 4-3s-1-3-4-3h-4v6Zm0 8h5c3 0 5-1 5-3s-2-3-5-3h-5v6Z"/>','Banglalink');
  if(text.includes('teletalk'))return svg('<circle cx="24" cy="24" r="21" fill="#69A83B"/><path fill="#fff" d="M12 13h24v6h-9v17h-6V19h-9v-6Z"/>','Teletalk');
  return svg('<rect x="8" y="5" width="32" height="38" rx="7" fill="#345BFF"/><rect x="13" y="11" width="22" height="21" rx="3" fill="#fff"/><circle cx="24" cy="37" r="2.5" fill="#fff"/>','Mobile Recharge');
}
function transactionLogo(service,operator){return brandSvg(service,operator)}
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
    const old=map.get(x.number)||{number:x.number,count:0,total:0,last:null,lastAmount:0,lastService:'—',operator:detectOperator(x.number||'')};
    old.count+=1;
    old.total+=Number(x.amount||0);
    if(!old.last || new Date(x.timestamp)>new Date(old.last)){
      old.last=x.timestamp; old.lastAmount=Number(x.amount||0); old.lastService=x.service||'—'; old.operator=x.operator||detectOperator(x.number||'');
    }
    map.set(x.number,old);
  }
  for(const n of historyList){
    if(!map.has(n)) map.set(n,{number:n,count:0,total:0,last:null,lastAmount:0,lastService:'—',operator:detectOperator(n)});
  }
  return [...map.values()].sort((a,b)=>{
    const ad=a.last?new Date(a.last).getTime():0, bd=b.last?new Date(b.last).getTime():0;
    return bd-ad || b.count-a.count;
  });
}
function formatCustomerLast(iso){
  if(!iso)return 'কোনো সময় নেই';
  const d=new Date(iso);
  return d.toLocaleDateString('en-GB')+' • '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function renderAllCustomers(){
  const q=customersSearch.value.replace(/\D/g,'').slice(0,11);
  customersSearch.value=q;
  const rows=customerRows().filter(x=>!q||x.number.includes(q));
  customersCount.textContent=rows.length+' customer';
  if(!rows.length){customersListEl.innerHTML='<div class="historyNoMatch">কোনো নাম্বার পাওয়া যায়নি।</div>';return}
  customersListEl.innerHTML=rows.map(x=>`
    <button class="customerCard" data-number="${x.number}" data-amount="${x.lastAmount||''}">
      <div class="customerPhoneRow">${serviceIconHtml(x.lastService,'customerServiceIcon')}<div class="customerPhone">${x.number}</div></div>
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
document.getElementById('customersButton')?.addEventListener('click',openCustomers);
document.getElementById('customersClose').addEventListener('click',closeCustomers);
customersOverlay.addEventListener('click',e=>{if(e.target===customersOverlay)closeCustomers()});
customersSearch.addEventListener('input',renderAllCustomers);
customersListEl.addEventListener('click',e=>{
  const card=e.target.closest('.customerCard'); if(!card)return;
  numberInput.value=card.dataset.number;
  if(card.dataset.amount) setAmount(card.dataset.amount);
  updatePreview(); updateAmount(); closeCustomers(); numberInput.focus();
});

document.getElementById('historyButton')?.addEventListener('click',openHistory);
document.getElementById('historyClose').addEventListener('click',closeHistory);
historyOverlay.addEventListener('click',e=>{if(e.target===historyOverlay)closeHistory()});
historySearch.addEventListener('input',renderCustomerHistory);


function escapeHtml(value){
  return String(value??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
}
const suggestionsManagerOverlay=document.getElementById('suggestionsManagerOverlay');
const suggestionsManagerSearch=document.getElementById('suggestionsManagerSearch');
const suggestionsManagerList=document.getElementById('suggestionsManagerList');
const suggestionsManagerCount=document.getElementById('suggestionsManagerCount');
const suggestionsExportButton=document.getElementById('suggestionsExportButton');
const todaySummaryPdfButton=document.getElementById('todaySummaryPdfButton');
const dailyArchiveButton=document.getElementById('dailyArchiveButton');
const dailyArchiveOverlay=document.getElementById('dailyArchiveOverlay');
const dailyArchiveList=document.getElementById('dailyArchiveList');

function crc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes){
    crc^=byte;
    for(let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
function u16(value){return [value&255,(value>>>8)&255]}
function u32(value){return [value&255,(value>>>8)&255,(value>>>16)&255,(value>>>24)&255]}
function makeStoredZip(files){
  const encoder=new TextEncoder();
  const localParts=[];
  const centralParts=[];
  let offset=0;
  for(const file of files){
    const nameBytes=encoder.encode(file.name);
    const dataBytes=typeof file.data==='string'?encoder.encode(file.data):file.data;
    const checksum=crc32(dataBytes);
    const local=new Uint8Array([
      ...u32(0x04034b50),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0),
      ...u32(checksum),...u32(dataBytes.length),...u32(dataBytes.length),...u16(nameBytes.length),...u16(0),
      ...nameBytes,...dataBytes
    ]);
    localParts.push(local);
    const central=new Uint8Array([
      ...u32(0x02014b50),...u16(20),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0),
      ...u32(checksum),...u32(dataBytes.length),...u32(dataBytes.length),...u16(nameBytes.length),...u16(0),
      ...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset),...nameBytes
    ]);
    centralParts.push(central);
    offset+=local.length;
  }
  const centralSize=centralParts.reduce((sum,p)=>sum+p.length,0);
  const end=new Uint8Array([
    ...u32(0x06054b50),...u16(0),...u16(0),...u16(files.length),...u16(files.length),
    ...u32(centralSize),...u32(offset),...u16(0)
  ]);
  return new Blob([...localParts,...centralParts,end],{type:'application/zip'});
}
function csvCell(value){
  const text=String(value??'');
  return /[",\n\r]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;
}
function exportAllSuggestionNumbers(){
  const rows=suggestionManagerRows();
  if(!rows.length){setStatus('Export করার মতো কোনো নাম্বার নেই',false);return}
  const ordered=[...rows].sort((a,b)=>a.number.localeCompare(b.number));
  const txt=ordered.map(x=>x.number).join('\r\n')+'\r\n';
  const csv=['Number,Name',...ordered.map(x=>`${csvCell(x.number)},${csvCell(x.name)}`)].join('\r\n')+'\r\n';
  const info=[
    'Infinity Telecom - Exported Numbers',
    `Total Numbers: ${ordered.length}`,
    `Exported At: ${new Date().toLocaleString('en-BD')}`,
    '',
    'numbers.txt = শুধু সকল মোবাইল নাম্বার',
    'numbers.csv = নাম্বার ও সংরক্ষিত নাম'
  ].join('\r\n');
  const zip=makeStoredZip([
    {name:'numbers.txt',data:txt},
    {name:'numbers.csv',data:'\ufeff'+csv},
    {name:'README.txt',data:info}
  ]);
  const url=URL.createObjectURL(zip);
  const link=document.createElement('a');
  const date=new Date().toISOString().slice(0,10);
  link.href=url;
  link.download=`Infinity-Telecom-Numbers-${date}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
  setStatus(`${ordered.length}টি নাম্বার ZIP হিসেবে Export হয়েছে`,true);
}

function pdfEscape(text){return String(text??'').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[\r\n]+/g,' ')}
function downloadSimplePdf(filename,title,lines){
  const safeLines=[title,'',...lines].map(pdfEscape);
  let stream='BT\n/F1 16 Tf\n50 790 Td\n';
  safeLines.forEach((line,index)=>{
    if(index===0) stream+=`(${line}) Tj\n/F1 10 Tf\n0 -24 Td\n`;
    else stream+=`(${line}) Tj\n0 -16 Td\n`;
  });
  stream+='ET';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf='%PDF-1.4\n';const offsets=[0];
  objects.forEach((obj,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`});
  const xref=pdf.length;pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(o=>pdf+=String(o).padStart(10,'0')+' 00000 n \n');
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const blob=new Blob([pdf],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function rowsForDate(date){return transactionHistory.filter(x=>sameDay(new Date(x.timestamp),date))}
function summaryForDate(date){
  const rows=rowsForDate(date),services={};
  rows.forEach(x=>{const k=x.service||'Unknown',s=services[k]||(services[k]={count:0,total:0});s.count++;s.total+=Number(x.amount||0)});
  return {date,rows,services,total:rows.reduce((s,x)=>s+Number(x.amount||0),0)};
}
function exportTodaySummaryPdf(){
  const data=summaryForDate(new Date());
  const lines=[
    `Date: ${data.date.toLocaleDateString('en-GB')}`,
    `Generated: ${new Date().toLocaleString('en-GB')}`,
    '----------------------------------------------',
    ...['Mobile Recharge','bKash','Nagad','Rocket'].map(name=>{
      const s=data.services[name]||{count:0,total:0};return `${name}: ${s.count} transactions | BDT ${s.total.toLocaleString('en-US')}`;
    }),
    '----------------------------------------------',
    `Grand Total Transactions: ${data.rows.length}`,
    `Grand Total Amount: BDT ${data.total.toLocaleString('en-US')}`
  ];
  downloadSimplePdf(`Infinity-Telecom-Daily-Summary-${localDateKey(new Date())}.pdf`,'INFINITY TELECOM - DAILY SUMMARY',lines);
  setStatus('আজকের Summary PDF ডাউনলোড হয়েছে',true);
}
function groupedDailyArchive(){
  const map=new Map();
  transactionHistory.forEach(x=>{
    const d=new Date(x.timestamp);if(Number.isNaN(d.getTime()))return;
    const key=localDateKey(d),v=map.get(key)||{date:new Date(d.getFullYear(),d.getMonth(),d.getDate()),rows:[]};v.rows.push(x);map.set(key,v);
  });
  return [...map.values()].sort((a,b)=>b.date-a.date);
}
function renderDailyArchive(){
  const days=groupedDailyArchive();
  if(!days.length){dailyArchiveList.innerHTML='<div class="suggestionsManagerEmpty">কোনো Daily History নেই।</div>';return}
  dailyArchiveList.innerHTML=days.map(day=>{
    const services={};day.rows.forEach(x=>{const k=x.service||'Unknown',s=services[k]||(services[k]={count:0,total:0});s.count++;s.total+=Number(x.amount||0)});
    const total=day.rows.reduce((s,x)=>s+Number(x.amount||0),0);
    const mfs=['bKash','Nagad','Rocket'].map(k=>{const s=services[k]||{count:0,total:0};return `<span><b>${k}</b> ${s.count} বার · ৳${s.total.toLocaleString('en-US')}</span>`}).join('');
    return `<article class="dailyArchiveItem"><div><strong>${day.date.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</strong><small>${day.rows.length} লেনদেন · মোট ৳${total.toLocaleString('en-US')}</small></div><div class="dailyArchiveServices">${mfs}</div></article>`;
  }).join('');
}
function openDailyArchive(){renderDailyArchive();dailyArchiveOverlay.classList.add('show')}
function closeDailyArchive(){dailyArchiveOverlay.classList.remove('show')}
async function resetNumberHistory(number){
  const rows=transactionHistory.filter(x=>x.number===number);
  if(!rows.length){setStatus('এই নাম্বারের কোনো History নেই',false);return}
  if(!confirm(`${number} নাম্বারের ${rows.length}টি লেনদেন Reset করবেন?\n\nনাম্বার Suggestions-এ থাকবে, শুধু History ও Amount শূন্য হবে।`))return;
  setCloud('☁️ History Reset হচ্ছে','busy');
  try{
    await Promise.all(rows.map(x=>deleteDoc(doc(db,'users',currentUser.uid,'transactions',x.id))));
    await setDoc(doc(db,'users',currentUser.uid,'customers',number),{
      number,visitCount:0,lastAmount:0,lastService:'',lastUsedAt:serverTimestamp(),updatedAt:serverTimestamp()
    },{merge:true});
    transactionHistory=transactionHistory.filter(x=>x.number!==number);
    customerProfiles.set(number,{...(customerProfiles.get(number)||{}),number,visitCount:0,lastAmount:0,lastService:''});
    renderSuggestionsManager();updateSuggestions();renderDashboard();updateCustomerSummary();renderDailyArchive();
    setCloud('☁️ Cloud Sync: Active');setStatus(`${number} নাম্বারের History Reset হয়েছে`,true);
  }catch(err){console.error(err);setCloud('☁️ Sync Error','error');setStatus('History Reset করা যায়নি: '+err.message,false)}
}

function suggestionManagerRows(){
  return historyList.map(number=>({number,name:String(customerProfiles.get(number)?.name||'').trim()}));
}
function renderSuggestionsManager(){
  const q=String(suggestionsManagerSearch?.value||'').trim().toLowerCase();
  const rows=suggestionManagerRows().filter(x=>!q||x.number.includes(q)||x.name.toLowerCase().includes(q));
  suggestionsManagerCount.textContent=`${rows.length} suggestion`;
  if(!rows.length){suggestionsManagerList.innerHTML='<div class="suggestionsManagerEmpty">কোনো Suggestion পাওয়া যায়নি।</div>';return}
  suggestionsManagerList.innerHTML=rows.map(x=>`<article class="suggestionsManagerItem" data-number="${x.number}">
    <div class="suggestionsManagerIdentity">
      <div class="suggestionsManagerIcon">${brandSvg(transactionHistory.find(t=>t.number===x.number)?.service||'Mobile Recharge',detectOperator(x.number))}</div>
      <div><strong>${x.name?escapeHtml(x.name):'নাম দেওয়া হয়নি'}</strong><span>${x.number}</span></div>
    </div>
    <div class="suggestionsManagerActions"><button class="suggestionEditButton" type="button">✎ নাম Edit</button><button class="suggestionResetHistoryButton" type="button">↺ History Reset</button><button class="suggestionRemoveButton" type="button">⌫ Remove</button></div>
  </article>`).join('');
}
function openSuggestionsManager(){suggestionsManagerOverlay.classList.add('show');suggestionsManagerSearch.value='';renderSuggestionsManager();setTimeout(()=>suggestionsManagerSearch.focus(),80)}
function closeSuggestionsManager(){suggestionsManagerOverlay.classList.remove('show')}
document.getElementById('suggestionsManageButton')?.addEventListener('click',openSuggestionsManager);
suggestionsExportButton?.addEventListener('click',exportAllSuggestionNumbers);
todaySummaryPdfButton?.addEventListener('click',exportTodaySummaryPdf);
dailyArchiveButton?.addEventListener('click',openDailyArchive);
document.getElementById('dailyArchiveClose')?.addEventListener('click',closeDailyArchive);
dailyArchiveOverlay?.addEventListener('click',e=>{if(e.target===dailyArchiveOverlay)closeDailyArchive()});
document.getElementById('suggestionsManagerClose')?.addEventListener('click',closeSuggestionsManager);
suggestionsManagerOverlay?.addEventListener('click',e=>{if(e.target===suggestionsManagerOverlay)closeSuggestionsManager()});
suggestionsManagerSearch?.addEventListener('input',renderSuggestionsManager);
suggestionsManagerList?.addEventListener('click',async e=>{
  const item=e.target.closest('.suggestionsManagerItem'); if(!item||!currentUser)return;
  const number=item.dataset.number;
  if(e.target.closest('.suggestionEditButton')){
    const oldName=customerProfiles.get(number)?.name||'';
    const name=prompt('এই নাম্বারের জন্য নাম লিখুন:',oldName);
    if(name===null)return;
    const clean=name.trim().slice(0,50);
    try{
      await setDoc(doc(db,'users',currentUser.uid,'customers',number),{number,name:clean,updatedAt:serverTimestamp()},{merge:true});
      customerProfiles.set(number,{...(customerProfiles.get(number)||{}),number,name:clean});
      renderSuggestionsManager(); updateSuggestions(); setCloud('☁️ Cloud Sync: Active');
    }catch(err){setStatus('নাম পরিবর্তন করা যায়নি: '+err.message,false)}
  }
  if(e.target.closest('.suggestionResetHistoryButton')){
    await resetNumberHistory(number);return;
  }
  if(e.target.closest('.suggestionRemoveButton')){
    if(!confirm(`${number} নাম্বারটি Suggestions থেকে সরাবেন?`))return;
    try{
      await deleteDoc(doc(db,'users',currentUser.uid,'customers',number));
      historyList=historyList.filter(n=>n!==number); customerProfiles.delete(number);
      renderSuggestionsManager(); updateSuggestions(); renderDashboard(); setCloud('☁️ Cloud Sync: Active');
    }catch(err){setStatus('Suggestion সরানো যায়নি: '+err.message,false)}
  }
});

function detectOperator(n){
  const p=n.slice(0,3);
  if(['013','017'].includes(p))return 'Grameenphone';
  if(['014','019'].includes(p))return 'Banglalink';
  if(p==='015')return 'Teletalk';
  if(p==='016')return 'Airtel';
  if(p==='018')return 'Robi';
  return 'Unknown';
}

let successPopupLanguage='bn';
function setSuccessPopupLanguage(language='bn'){
  successPopupLanguage=language==='en'?'en':'bn';
  const isBangla=successPopupLanguage==='bn';
  document.getElementById('successTitle').textContent=isBangla?'লেনদেন সফল হয়েছে':'Transaction Successful';
  document.getElementById('successText').textContent=isBangla?'আপনার অনুরোধটি সফলভাবে পাঠানো হয়েছে।':'Your request has been sent successfully.';
  document.getElementById('successAmountLabel').textContent=isBangla?'পরিমাণ':'Amount';
  document.getElementById('successGatewayLabel').textContent=isBangla?'গেটওয়ে':'Gateway';
  document.getElementById('successDone').textContent=isBangla?'সম্পন্ন':'Done';
  document.getElementById('successLanguageToggle').textContent=isBangla?'EN':'বাংলা';
}
document.getElementById('successLanguageToggle').addEventListener('click',()=>{
  setSuccessPopupLanguage(successPopupLanguage==='bn'?'en':'bn');
});

function showSuccessPopup(n,amount,service){
  setSuccessPopupLanguage('bn');
  document.getElementById('successNumber').innerHTML=`${serviceIconHtml(service,'successServiceIcon')}<span>${n}</span>`;
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
  if(e.key==='Escape'&&dailyArchiveOverlay?.classList.contains('show')){closeDailyArchive();return}
  if(e.key==='Escape'&&suggestionsManagerOverlay?.classList.contains('show')){closeSuggestionsManager();return}
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
  if(recent) recent.innerHTML=tx.slice(0,4).map(x=>`<div class="miniRow"><strong class="miniNumberWithIcon">${serviceIconHtml(x.service,'miniServiceIcon')}<span>${x.number}</span></strong><span>${x.service}</span><em>${formatMoney(x.amount)}</em></div>`).join('')||'<div class="emptyMini">No recharge history yet</div>';
  const counts={};
  tx.forEach(x=>{const c=counts[x.number]||(counts[x.number]={count:0,total:0});c.count++;c.total+=Number(x.amount||0)});
  const top=Object.entries(counts).sort((a,b)=>b[1].count-a[1].count).slice(0,4);
  const topEl=document.getElementById('topCustomersList');
  if(topEl) topEl.innerHTML=top.map(([n,v])=>`<div class="miniRow"><strong>${n}</strong><span>${v.count} Times</span><em>${formatMoney(v.total)}</em></div>`).join('')||'<div class="emptyMini">No customer data yet</div>';
  const sums={};
  tx.forEach(x=>{
    const k=x.service||'Unknown';
    const isDailyMfs=['bKash','Nagad','Rocket'].includes(k);
    if(isDailyMfs&&!sameDay(new Date(x.timestamp),now))return;
    const s=sums[k]||(sums[k]={count:0,total:0});s.count++;s.total+=Number(x.amount||0);
  });
  const orderedServices=['Mobile Recharge','bKash','Nagad','Rocket'].filter(k=>sums[k]);
  const sumEl=document.getElementById('serviceSummaryList');
  if(sumEl) sumEl.innerHTML=orderedServices.map(k=>{const v=sums[k];return `<div class="miniRow"><strong>${k}</strong><span>${formatMoney(v.total)}</span><em>${v.count}</em></div>`}).join('')||'<div class="emptyMini">No service data yet</div>';
}
function tickDateTime(){const e=document.getElementById('currentDateTime');if(e)e.textContent=new Date().toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
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
setTimeout(()=>{
  sendPendingDailyReport();renderDashboard();
  setInterval(()=>{sendPendingDailyReport();renderDashboard()},24*60*60*1000)
},msUntilNextMidnight());

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

/* UI Color Wheel — keeps the original layout unchanged */
const colorButton=document.getElementById('colorButton');
const colorOverlay=document.getElementById('colorOverlay');
const colorClose=document.getElementById('colorClose');
const uiColorPicker=document.getElementById('uiColorPicker');
const uiColorValue=document.getElementById('uiColorValue');
const shadowRange=document.getElementById('shadowRange');
const shadowValue=document.getElementById('shadowValue');
const colorResetButton=document.getElementById('colorResetButton');
function hexToRgb(hex){
  const clean=hex.replace('#','');
  const full=clean.length===3?clean.split('').map(x=>x+x).join(''):clean;
  return [parseInt(full.slice(0,2),16),parseInt(full.slice(2,4),16),parseInt(full.slice(4,6),16)];
}
function applyUiColor(hex,shadow,save=true){
  const rgb=hexToRgb(hex);
  const strength=Math.max(0,Math.min(100,Number(shadow)))/100;
  document.documentElement.style.setProperty('--ui-accent',hex);
  document.documentElement.style.setProperty('--ui-accent-rgb',rgb.join(','));
  document.documentElement.style.setProperty('--ui-shadow-strength',String(strength));
  uiColorPicker.value=hex;uiColorValue.textContent=hex.toUpperCase();
  shadowRange.value=String(Math.round(strength*100));shadowValue.textContent=`${Math.round(strength*100)}%`;
  if(save){localStorage.setItem('infinityUiColor',hex);localStorage.setItem('infinityUiShadow',String(Math.round(strength*100)))}
}
const savedUiColor=localStorage.getItem('infinityUiColor')||'#775cff';
const savedUiShadow=localStorage.getItem('infinityUiShadow')||'45';
applyUiColor(savedUiColor,savedUiShadow,false);
colorButton?.addEventListener('click',()=>colorOverlay.classList.add('show'));
colorClose?.addEventListener('click',()=>colorOverlay.classList.remove('show'));
colorOverlay?.addEventListener('click',e=>{if(e.target===colorOverlay)colorOverlay.classList.remove('show')});
uiColorPicker?.addEventListener('input',()=>applyUiColor(uiColorPicker.value,shadowRange.value));
shadowRange?.addEventListener('input',()=>applyUiColor(uiColorPicker.value,shadowRange.value));
colorResetButton?.addEventListener('click',()=>applyUiColor('#775cff',45));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&colorOverlay?.classList.contains('show'))colorOverlay.classList.remove('show')});

/* Click anywhere on the customer preview area to return focus to Mobile Number.
   Interactive controls inside the preview keep their normal behavior. */
const previewPanel=document.querySelector('.previewPanel');
previewPanel?.addEventListener('click',event=>{
  if(event.target.closest('button,input,select,textarea,a,[role="button"],.summaryChoiceMenu')) return;
  numberInput.focus();
  const end=numberInput.value.length;
  try{numberInput.setSelectionRange(end,end)}catch(_error){}
});


/* Double-press Enter: instantly return to the Mobile Number box.
   The second Enter is consumed so it cannot accidentally send twice. */
let lastEnterPressAt = 0;
const DOUBLE_ENTER_DELAY = 500;

document.addEventListener('keydown', event => {
  if (
    event.key !== 'Enter' ||
    event.repeat ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  ) return;

  const now = Date.now();

  if (now - lastEnterPressAt <= DOUBLE_ENTER_DELAY) {
    event.preventDefault();
    event.stopImmediatePropagation();
    lastEnterPressAt = 0;

    hideSuggestions();
    closeSummaryMenus();

    /* Close the success popup first, when it is currently open. */
    const successOverlay = document.getElementById('successOverlay');
    if (successOverlay?.classList.contains('show')) {
      successOverlay.classList.remove('show');
      numberInput.value = '';
      setAmount('');
      updatePreview();
      updateAmount();
      setStatus('', true);
    }

    numberInput.disabled = false;
    numberInput.focus();
    numberInput.select();
    return;
  }

  lastEnterPressAt = now;
}, true);
