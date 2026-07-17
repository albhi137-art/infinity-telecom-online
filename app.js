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
  setCloud('☁️ Cloud Synced');
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
