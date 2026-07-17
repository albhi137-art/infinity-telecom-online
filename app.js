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
const amountInput=document.getElementById('amountInput');
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
}
function updateSuggestions(){
  const q=numberInput.value;
  if(q.length<2){hideSuggestions();return}
  currentMatches=historyList.filter(n=>n.startsWith(q)&&n!==q);
  if(!currentMatches.length){hideSuggestions();return}
  activeIndex=0;
  suggestions.innerHTML=currentMatches.slice(0,15).map((n,i)=>
    `<button class="suggestion${i===0?' active':''}" data-number="${n}"><span>${n}</span><span>↵</span></button>`
  ).join('');
  suggestions.classList.add('show');
}
function hideSuggestions(){suggestions.classList.remove('show');suggestions.innerHTML='';currentMatches=[]}
function chooseNumber(n){numberInput.value=n;updatePreview();hideSuggestions();numberInput.focus()}
suggestions.addEventListener('click',e=>{const b=e.target.closest('.suggestion');if(b)chooseNumber(b.dataset.number)});
numberInput.addEventListener('input',updatePreview);
numberInput.addEventListener('keydown',e=>{
  if(e.key==='ArrowDown'&&currentMatches.length){e.preventDefault();activeIndex=(activeIndex+1)%currentMatches.length;paintActive()}
  else if(e.key==='ArrowUp'&&currentMatches.length){e.preventDefault();activeIndex=(activeIndex-1+currentMatches.length)%currentMatches.length;paintActive()}
  else if(e.key==='Enter'){e.preventDefault();if(currentMatches.length)chooseNumber(currentMatches[activeIndex]);else amountInput.focus()}
  else if(e.key==='Escape'){numberInput.value='';updatePreview();hideSuggestions()}
});
function paintActive(){[...suggestions.children].forEach((x,i)=>x.classList.toggle('active',i===activeIndex))}

document.querySelectorAll('.pill').forEach(b=>b.addEventListener('click',()=>{
  amountInput.value=b.dataset.amount;
  document.querySelectorAll('.pill').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');updateAmount();
}));
amountInput.addEventListener('input',()=>{
  amountInput.value=amountInput.value.replace(/[^0-9.]/g,'');
  document.querySelectorAll('.pill').forEach(x=>x.classList.remove('active'));
  updateAmount();
});
function updateAmount(){document.getElementById('selectedAmount').textContent='৳'+(amountInput.value||'0.00')}

document.querySelectorAll('.service').forEach(b=>b.addEventListener('click',async()=>{
  document.querySelectorAll('.service').forEach(x=>x.classList.remove('selected'));
  b.classList.add('selected');
  selectedService=b.dataset.service;
  document.getElementById('selectedService').textContent=selectedService;
  const sdt=document.getElementById('serviceDisplayText'); if(sdt)sdt.textContent=selectedService;
  await send();
}));

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
  historyResult.classList.remove('show');
  historyEmpty.style.display='flex';
  historyEmpty.textContent='নাম্বার লিখলে এখানে সম্পূর্ণ History দেখাবে।';
  setTimeout(()=>historySearch.focus(),80);
}
function closeHistory(){historyOverlay.classList.remove('show')}
function formatHistoryDate(iso){
  const d=new Date(iso);
  return d.toLocaleDateString('en-GB')+' • '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function renderCustomerHistory(){
  const q=historySearch.value.replace(/\D/g,'').slice(0,11);
  historySearch.value=q;
  if(q.length<3){
    historyResult.classList.remove('show');historyEmpty.style.display='flex';
    historyEmpty.textContent='কমপক্ষে ৩টি সংখ্যা লিখুন।';return;
  }
  const matches=transactionHistory.filter(x=>x.number.includes(q));
  if(!matches.length){
    historyResult.classList.remove('show');historyEmpty.style.display='flex';
    historyEmpty.textContent='এই নাম্বারের কোনো History পাওয়া যায়নি।';return;
  }
  const exact=matches.filter(x=>x.number===q);
  const rows=exact.length?exact:matches;
  const shownNumber=exact.length?q:rows[0].number;
  const sameNumberRows=rows.filter(x=>x.number===shownNumber);
  const total=sameNumberRows.reduce((sum,x)=>sum+Number(x.amount||0),0);
  const last=sameNumberRows[0];

  document.getElementById('historyCustomer').textContent=shownNumber;
  document.getElementById('historyCount').textContent=sameNumberRows.length+' বার';
  document.getElementById('historyTotal').textContent='৳'+total.toLocaleString('en-BD');
  document.getElementById('historyLast').textContent=last?last.service:'—';
  historyListEl.innerHTML=sameNumberRows.map((x,i)=>`
    <div class="historyItem">
      <div class="historyIndex">${i+1}</div>
      <div class="historyMeta"><strong>${x.service}</strong>
      <span>${x.operator} • ${formatHistoryDate(x.timestamp)}</span></div>
      <div class="historyAmount">৳${Number(x.amount).toLocaleString('en-BD')}</div>
    </div>`).join('');
  historyEmpty.style.display='none';historyResult.classList.add('show');
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
  if(card.dataset.amount) amountInput.value=card.dataset.amount;
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
  document.getElementById('successOperator').textContent=detectOperator(n);
  document.getElementById('successGateway').textContent=service;
  document.getElementById('successOverlay').classList.add('show');
  document.getElementById('successDone').focus();
}
function closeSuccessPopup(){
  document.getElementById('successOverlay').classList.remove('show');
  numberInput.value='';amountInput.value='';
  document.querySelectorAll('.pill').forEach(x=>x.classList.remove('active'));
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
async function send(){
  if(!currentUser){setStatus('আগে Login করুন',false);return}
  const n=numberInput.value.replace(/\D/g,'');
  const amount=(amountInput.value||'').trim();
  if(!validNumber(n)){setStatus('আগে সঠিক ১১ সংখ্যার নাম্বার দিন',false);numberInput.focus();return}
  if(!amount||Number(amount)<=0){setStatus('আগে সঠিক Amount দিন',false);amountInput.focus();return}

  const buttons=[...document.querySelectorAll('.service')];
  buttons.forEach(x=>x.disabled=true);
  setStatus(`${selectedService} পাঠানো হচ্ছে...`,true);
  try{
    const r=await fetch('/api/send',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        number:n,
        amount:Number(amount),
        service:selectedService,
        message:messageText(n)
      })
    });
    const data=await r.json();
    if(!r.ok||!data.ok)throw new Error(data.error||'Send failed');
    await saveTransaction(n,amount,selectedService);
    setStatus(`${selectedService} সফলভাবে পাঠানো হয়েছে`,true);
    showSuccessPopup(n,amount,selectedService);
  }catch(err){
    console.error(err);
    setCloud('☁️ Sync Error','error');
    setStatus(location.protocol==='file:'?'ফাইল ডাবল-ক্লিক নয়—Render link দিয়ে চালান':err.message,false);
  }finally{buttons.forEach(x=>x.disabled=false)}
}
function setStatus(t,ok){statusEl.textContent=t;statusEl.style.color=ok?'#43d679':'#ff5b5b'}
window.addEventListener('online',()=>document.getElementById('offline').classList.remove('show'));
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
  const today=tx.filter(x=>sameDay(new Date(x.timestamp),now)).reduce((s,x)=>s+Number(x.amount||0),0);
  const set=(id,val)=>{const e=document.getElementById(id);if(e)e.textContent=val};
  set('statNumbers',historyList.length.toLocaleString('en-US'));
  set('statCustomers',unique.length.toLocaleString('en-US'));
  set('statRecharge',formatMoney(total)); set('statToday',formatMoney(today));
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
if(globalSearch){globalSearch.addEventListener('input',()=>{numberInput.value=globalSearch.value.replace(/\D/g,'').slice(0,11);updatePreview()});globalSearch.addEventListener('keydown',e=>{if(e.key==='Enter'){numberInput.focus();amountInput.focus()}})}
document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='/'){e.preventDefault();globalSearch?.focus()}});
document.getElementById('recentViewAll')?.addEventListener('click',openHistory);
document.getElementById('topViewAll')?.addEventListener('click',openCustomers);
