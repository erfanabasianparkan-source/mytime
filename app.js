/* ---------- storage ---------- */
function localDateKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

const DEFAULTS = {
  settings:{wake:"07:30",sleep:"23:30",uniCommute:20,gymCommute:15,workStart:"09:30",workEnd:"14:00",
    gymGoal:5,restDays:["جمعه"],dayBoundary:4,termStart:localDateKey(new Date())},
  classes:[], // {id,title,day,start,end,parity} parity: all|odd|even
  tasks:[], // {id,type,title,start,end,date,done,deferred,deadline,leadDays,parity,day,recurring,subtasks:[{title,minutes,done}]}
  log:{lastWake:null,lastSleep:null,badDay:false,adhoc:[]}
};
function load(){ try{ return JSON.parse(localStorage.getItem('planner_v1'))||structuredClone(DEFAULTS);}catch(e){return structuredClone(DEFAULTS);} }
function save(){ localStorage.setItem('planner_v1', JSON.stringify(DB)); }
let DB = load();
for(const k in DEFAULTS){ if(!(k in DB)) DB[k]=structuredClone(DEFAULTS[k]); }

/* ---------- jalali date ---------- */
function toJalali(gy,gm,gd){
  const g_d_m=[0,31,59,90,120,151,181,212,243,273,304,334];
  let jy = (gy<=1600)?0:979; gy -= (gy<=1600)?621:1600;
  let gy2 = (gm>2)?(gy+1):gy;
  let days = (365*gy)+parseInt((gy2+3)/4)-parseInt((gy2+99)/100)+parseInt((gy2+399)/400)-80+gd+g_d_m[gm-1];
  jy += 33*parseInt(days/12053); days%=12053;
  jy += 4*parseInt(days/1461); days%=1461;
  if(days>365){ jy += parseInt((days-1)/365); days=(days-1)%365; }
  let jm, jd;
  if(days<186){ jm=1+parseInt(days/31); jd=1+(days%31); }
  else { jm=7+parseInt((days-186)/30); jd=1+((days-186)%30); }
  return [jy,jm,jd];
}
const JM=["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"];
const WD=["یکشنبه","دوشنبه","سه‌شنبه","چهارشنبه","پنجشنبه","جمعه","شنبه"];
function effectiveNow(){
  const n=new Date();
  const b=DB.settings.dayBoundary;
  const d=new Date(n); if(n.getHours()<b) d.setDate(d.getDate()-1);
  return d;
}
function weekdayFa(dateObj){ return WD[dateObj.getDay()]; }

/* ---------- clock/date render ---------- */
function tick(){
  const now=new Date();
  document.getElementById('clock').textContent = now.toLocaleTimeString('fa-IR',{hour12:false});
  const [jy,jm,jd]=toJalali(now.getFullYear(),now.getMonth()+1,now.getDate());
  document.getElementById('jdate').textContent = `${weekdayFa(now)} ${jd} ${JM[jm-1]} ${jy}`;
  document.getElementById('gdate').textContent = now.toLocaleDateString('en-CA');
}
setInterval(tick,1000); tick();

/* ---------- time helpers ---------- */
const toMin=t=>{const[h,m]=t.split(':').map(Number);return h*60+m;};
const toHM=m=>{m=((m%1440)+1440)%1440; return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');};

function weekParityFor(dateObj){
  const start=new Date(DB.settings.termStart);
  const diffWeeks=Math.floor((dateObj-start)/(7*86400000));
  return diffWeeks%2===0?'odd':'even'; // week 0 = فرد (اول ترم)
}

function todaysClasses(dateObj){
  const wd=weekdayFa(dateObj), par=weekParityFor(dateObj);
  return DB.classes.filter(c=>c.day===wd && (c.parity==='all'||c.parity===par))
    .map(c=>({id:'cls_'+c.id,type:'fixed',title:'کلاس: '+c.title,start:c.start,end:c.end,fixedSrc:true}));
}

const MORNING_ROUTINE=[
  {key:'bed',title:'مرتب کردن تخت',min:2,prio:1},
  {key:'shower',title:'دوش صبح',min:15,prio:2},
  {key:'ready',title:'آماده شدن',min:15,prio:1},
  {key:'breakfast',title:'صبحانه',min:15,prio:3},
];

function buildTimeline(){
  const now=effectiveNow();
  const dateKey=localDateKey(now);
  const wd=weekdayFa(now);
  const isGymDay = !DB.settings.restDays.includes(wd);
  let fixed = todaysClasses(now);
  const workFixed = {id:'work',type:'fixed',title:'کار آزاد',start:DB.settings.workStart,end:DB.settings.workEnd};
  if(wd!=='جمعه') fixed.push(workFixed);
  // user-added fixed tasks for today (by day match or dated today)
  fixed = fixed.concat(DB.tasks.filter(t=>t.type==='fixed' && !t.done && (t.date===dateKey || t.day===wd)));
  // adhoc fixed with explicit time
  fixed = fixed.concat(DB.log.adhoc.filter(a=>a.date===dateKey && a.end).map(a=>({id:a.id,type:'fixed',title:'یهویی: '+a.title,start:a.start,end:a.end,adhoc:true})));
  fixed.sort((a,b)=>toMin(a.start)-toMin(b.start));

  let items=[];
  // open-ended adhoc "in progress"
  DB.log.adhoc.filter(a=>a.date===dateKey && !a.end).forEach(a=>{
    items.push({id:a.id,type:'fixed',title:'⏳ '+a.title+' (در حال انجام)',start:a.start,end:'',inprogress:true,adhoc:true});
  });

  const wakeMin = DB.log.lastWake && DB.log.lastWake.slice(0,10)===dateKey ? toMin(DB.log.lastWake.slice(11,16)) : toMin(DB.settings.wake);
  const firstFixedMin = fixed.length? toMin(fixed[0].start) : 1440;
  let gap = Math.max(0, firstFixedMin - wakeMin - (fixed[0]&&fixed[0].title.startsWith('کلاس')?DB.settings.uniCommute:0));

  if(!DB.log.badDay){
    // pack morning routine by priority into gap
    let routine = MORNING_ROUTINE.map(r=>({...r}));
    if(isGymDay){ routine=MORNING_ROUTINE.filter(r=>r.key!=='shower'); }
    routine.sort((a,b)=>a.prio-b.prio);
    let used=0, placed=[]; let cursor=wakeMin;
    for(const r of routine){ if(used+r.min<=gap){ placed.push({...r,start:toHM(cursor),end:toHM(cursor+r.min)}); cursor+=r.min; used+=r.min; } }
    placed.forEach(p=>items.push({id:'m_'+p.key,type:'daily',title:p.title,start:p.start,end:p.end}));
    if(routine.length && placed.length<routine.length){
      document.getElementById('msgBox').innerHTML='<div class="msg">وقت کم بود؛ بعضی کارهای صبح حذف شدن تا کلاس/کار اصلی عقب نیفته.</div>';
    } else { document.getElementById('msgBox').innerHTML=''; }
  } else {
    document.getElementById('msgBox').innerHTML='<div class="msg">حالت «روز بد» فعاله — فقط کارهای اصلی نمایش داده می‌شن.</div>';
  }

  fixed.forEach(f=>items.push(f));

  if(isGymDay && !DB.log.badDay){
    // place a gym block in first gap after wake if no explicit gym task exists
    const hasGym = DB.tasks.some(t=>t.title.includes('باشگاه') && t.date===dateKey);
    if(!hasGym){
      items.push({id:'gym_auto',type:'daily',title:'باشگاه (پیشنهادی)',start:'', end:'', note:true});
    }
  }

  if(!DB.log.badDay){
    // semi + daily tasks (not date-specific ones show generically)
    DB.tasks.filter(t=>(t.type==='semi'||t.type==='daily') && !t.done).forEach(t=>items.push(t));
    // reminders whose leadDays window has arrived
    DB.tasks.filter(t=>t.type==='reminder' && !t.done && t.deadline).forEach(t=>{
      const days=(new Date(t.deadline)-now)/86400000;
      if(days<=(t.leadDays||3)) items.push(t);
    });
    // projects: show with progress
    DB.tasks.filter(t=>t.type==='project' && !t.done).forEach(t=>items.push(t));
  }

  render(items, fixed);
  buildTomorrowSection();
}

function buildTomorrowSection(){
  const tmr=effectiveNow(); tmr.setDate(tmr.getDate()+1);
  const dateKey=localDateKey(tmr);
  const wd=weekdayFa(tmr);
  let items=[];
  items=items.concat(todaysClasses(tmr));
  if(wd!=='جمعه') items.push({id:'work_tmr',type:'fixed',title:'کار آزاد',start:DB.settings.workStart,end:DB.settings.workEnd});
  items=items.concat(DB.tasks.filter(t=>t.type==='fixed' && !t.done && (t.date===dateKey || t.day===wd)));
  items=items.concat(DB.tasks.filter(t=>t.type==='semi' && !t.done));
  items.sort((a,b)=>toMin(a.start||'00:00')-toMin(b.start||'00:00'));

  const box=document.getElementById('tomorrowTimeline');
  if(!items.length){ box.innerHTML='<div class="empty">فردا کار اصلی یا نیمه‌مهمی ثبت نشده</div>'; return; }
  box.innerHTML = items.map(it=>{
    const timeTxt = it.start? (it.start+(it.end?(' – '+it.end):'')) : '';
    return `<div class="item type-${it.type}">
      <div class="meta"><div class="title">${it.title}</div><div class="t">${timeTxt}</div></div>
    </div>`;
  }).join('');
}

function render(items, fixed){
  const box=document.getElementById('timeline');
  if(!items.length){ box.innerHTML='<div class="empty">برنامه‌ای برای نمایش نیست — دکمه «بیدار شدم» رو بزن</div>'; return; }
  const seen=new Set();
  box.innerHTML = items.map(it=>{
    if(seen.has(it.id)) return ''; seen.add(it.id);
    const done = it.done?'done':'';
    const timeTxt = it.inprogress? 'از '+it.start : (it.start? (it.start+(it.end?(' – '+it.end):'')) : (it.note?'وقتی خالی شد':''));
    let sub='';
    if(it.type==='project' && it.subtasks){
      const done_n=it.subtasks.filter(s=>s.done).length;
      sub = `<div class="t">${done_n}/${it.subtasks.length} تسک انجام‌شده</div>`;
    }
    if(it.type==='reminder' && it.deadline) sub=`<div class="t">ددلاین: ${it.deadline}</div>`;
    let acts='';
    if(it.type==='fixed'){
      if(it.inprogress) acts=`<button onclick="finishAdhoc('${it.id}')">پایان</button>`;
      else acts=`<button onclick="markDone('${it.id}','${it.type}')">✓</button>`;
    } else if(!it.note){
      acts=`<button onclick="markDone('${it.id}','${it.type}')">✓</button>
            <button onclick="markState('${it.id}','${it.type}','later')">بعداً</button>
            <button onclick="markState('${it.id}','${it.type}','skip')">حال ندارم</button>`;
    }
    return `<div class="item type-${it.type} ${done}">
      <div class="meta"><div class="title">${it.title}</div><div class="t">${timeTxt}</div>${sub}</div>
      <div class="acts">${acts}</div>
    </div>`;
  }).join('');
}

function markDone(id,type){
  if(id.startsWith('m_')||id.startsWith('gym_')||id==='work'||id.startsWith('cls_')){ buildTimeline(); return; }
  const t=DB.tasks.find(x=>x.id===id); if(t){ t.done=true; save(); }
  buildTimeline();
}
function markState(id,type,state){
  const t=DB.tasks.find(x=>x.id===id);
  if(t){
    if(state==='later'){ if(t.start) t.start=toHM(toMin(t.start)+120); }
    else if(state==='skip'){ t.deferred=(t.deferred||0)+1; }
    save();
  }
  buildTimeline();
}

/* wake/sleep/adhoc/badday */
function onWake(){
  const dateKey=localDateKey(effectiveNow());
  DB.log.lastWake=dateKey+'T'+new Date().toTimeString().slice(0,5);
  DB.log.badDay=false;
  save(); buildTimeline();
}
function onSleep(){
  DB.log.lastSleep=new Date().toISOString();
  save();
  document.getElementById('msgBox').innerHTML='<div class="msg">شب بخیر 🌙 فردا صبح دکمه «بیدار شدم» رو بزن.</div>';
}
function onBadDay(){ DB.log.badDay=true; save(); buildTimeline(); }

function openAdhoc(){
  const m=document.getElementById('adhocModal');
  m.innerHTML=`<button class="close-x" onclick="closeAny()">×</button>
    <h3 style="margin-top:0">کار یهویی</h3>
    <label>عنوان</label><input id="adhTitle">
    <div class="row2">
      <div><label>شروع</label><input type="time" id="adhStart" value="${new Date().toTimeString().slice(0,5)}"></div>
      <div><label>پایان (اختیاری)</label><input type="time" id="adhEnd"></div>
    </div>
    <div class="actions">
      <button class="save-btn" onclick="saveAdhoc()">ثبت</button>
      <button class="cancel-btn" onclick="closeAny()">انصراف</button>
    </div>`;
  document.getElementById('adhocBg').classList.add('open');
}
function saveAdhoc(){
  const title=document.getElementById('adhTitle').value.trim(); if(!title) return;
  const start=document.getElementById('adhStart').value;
  const end=document.getElementById('adhEnd').value;
  DB.log.adhoc.push({id:'adh_'+Date.now(),title,start,end:end||null,date:localDateKey(effectiveNow())});
  save(); closeAny(); buildTimeline();
}
function finishAdhoc(id){
  const a=DB.log.adhoc.find(x=>x.id===id); if(a) a.end=new Date().toTimeString().slice(0,5);
  save(); buildTimeline();
}

/* menu / lists */
function openMenu(){ document.getElementById('menuBg').classList.add('open'); document.getElementById('menuSheet').classList.add('open'); }
function closeMenu(){ document.getElementById('menuBg').classList.remove('open'); document.getElementById('menuSheet').classList.remove('open'); }
let currentListType=null;
const TYPE_LABEL={fixed:'کارهای اصلی',semi:'نیمه‌مهم',daily:'روزانه',reminder:'یادآوری‌ها',project:'پروژه‌ها'};
function openList(type){
  closeMenu(); currentListType=type;
  document.getElementById('listTitle').textContent=TYPE_LABEL[type];
  renderList();
  document.getElementById('listBg').classList.add('open'); document.getElementById('listSheet').classList.add('open');
}
function closeList(){ document.getElementById('listBg').classList.remove('open'); document.getElementById('listSheet').classList.remove('open'); }
function renderList(){
  const items=DB.tasks.filter(t=>t.type===currentListType);
  document.getElementById('listBody').innerHTML = items.length? items.map(t=>
    `<div class="list-row"><span>${t.title}${t.done?' ✓':''}</span><span onclick="openTaskModal('${t.id}','${currentListType}')" style="cursor:pointer">ویرایش</span></div>`
  ).join('') : '<div class="empty">چیزی اضافه نشده</div>';
}

function closeAny(){ document.querySelectorAll('.modal-bg').forEach(m=>m.classList.remove('open')); }

function openTaskModal(id,type){
  const t = id? DB.tasks.find(x=>x.id===id) : {id:'t_'+Date.now(),type,title:'',start:'',end:'',date:'',day:'',deadline:'',leadDays:7,subtasks:[]};
  const m=document.getElementById('taskModal');
  let extra='';
  if(type==='fixed'||type==='semi'){
    extra=`<div class="row2"><div><label>شروع</label><input type="time" id="tkStart" value="${t.start||''}"></div>
    <div><label>پایان</label><input type="time" id="tkEnd" value="${t.end||''}"></div></div>
    <label>روز هفته (اختیاری، خالی=هر روز که تاریخش برسه)</label>
    <select id="tkDay"><option value="">—</option>${WD.map(d=>`<option ${t.day===d?'selected':''}>${d}</option>`).join('')}</select>`;
  }
  if(type==='reminder'){
    extra=`<label>تاریخ ددلاین</label><input type="date" id="tkDeadline" value="${t.deadline||''}">
    <label>چند روز قبل نشون بده</label><input type="number" id="tkLead" value="${t.leadDays||3}">`;
  }
  if(type==='project'){
    extra=`<label>تسک‌های زیرمجموعه (هرخط: عنوان,دقیقه)</label>
    <textarea id="tkSubs" rows="4">${(t.subtasks||[]).map(s=>s.title+','+s.minutes).join('\n')}</textarea>`;
  }
  m.innerHTML=`<button class="close-x" onclick="closeAny()">×</button>
    <h3 style="margin-top:0">${TYPE_LABEL[type]}</h3>
    <label>عنوان</label><input id="tkTitle" value="${t.title||''}">
    ${extra}
    <div class="actions">
      <button class="save-btn" onclick="saveTask('${t.id}','${type}')">ذخیره</button>
      ${id?`<button class="del-btn" onclick="delTask('${t.id}')">حذف</button>`:''}
      <button class="cancel-btn" onclick="closeAny()">انصراف</button>
    </div>`;
  document.getElementById('taskModalBg').classList.add('open');
}
function saveTask(id,type){
  let t=DB.tasks.find(x=>x.id===id);
  const isNew=!t; if(isNew){ t={id,type,done:false}; DB.tasks.push(t); }
  t.title=document.getElementById('tkTitle').value.trim();
  const s=document.getElementById('tkStart'), e=document.getElementById('tkEnd'), dy=document.getElementById('tkDay');
  if(s) t.start=s.value; if(e) t.end=e.value; if(dy) t.day=dy.value;
  const dl=document.getElementById('tkDeadline'), ld=document.getElementById('tkLead');
  if(dl){ t.deadline=dl.value; t.leadDays=parseInt(ld.value)||3; }
  const subs=document.getElementById('tkSubs');
  if(subs) t.subtasks=subs.value.split('\n').filter(Boolean).map(l=>{const[title,min]=l.split(','); return{title:title.trim(),minutes:parseInt(min)||0,done:false};});
  save(); closeAny(); renderList(); buildTimeline();
}
function delTask(id){ DB.tasks=DB.tasks.filter(t=>t.id!==id); save(); closeAny(); renderList(); buildTimeline(); }

/* settings */
function openSettings(){
  closeMenu();
  const s=DB.settings;
  document.getElementById('settingsModal').innerHTML=`<button class="close-x" onclick="closeAny()">×</button>
    <h3 style="margin-top:0">تنظیمات</h3>
    <div class="row2"><div><label>ساعت عادی بیداری</label><input type="time" id="sWake" value="${s.wake}"></div>
    <div><label>ساعت عادی خواب</label><input type="time" id="sSleep" value="${s.sleep}"></div></div>
    <div class="row2"><div><label>رفت‌وآمد دانشگاه (دقیقه)</label><input type="number" id="sUni" value="${s.uniCommute}"></div>
    <div><label>رفت‌وآمد باشگاه (دقیقه)</label><input type="number" id="sGymC" value="${s.gymCommute}"></div></div>
    <div class="row2"><div><label>شروع کار</label><input type="time" id="sWS" value="${s.workStart}"></div>
    <div><label>پایان کار</label><input type="time" id="sWE" value="${s.workEnd}"></div></div>
    <label>هدف جلسات باشگاه در هفته</label><input type="number" id="sGymG" value="${s.gymGoal}">
    <label>روزهای استراحت (با ویرگول)</label><input id="sRest" value="${s.restDays.join('،')}">
    <label>مرز شروع روز جدید (ساعت)</label><input type="number" id="sBound" value="${s.dayBoundary}">
    <label>تاریخ شروع ترم</label><input type="date" id="sTerm" value="${s.termStart}">
    <div class="actions"><button class="save-btn" onclick="saveSettings()">ذخیره</button>
    <button class="cancel-btn" onclick="closeAny()">انصراف</button></div>`;
  document.getElementById('settingsBg').classList.add('open');
}
function saveSettings(){
  const s=DB.settings;
  s.wake=sWake.value; s.sleep=sSleep.value; s.uniCommute=+sUni.value; s.gymCommute=+sGymC.value;
  s.workStart=sWS.value; s.workEnd=sWE.value; s.gymGoal=+sGymG.value;
  s.restDays=sRest.value.split(/[،,]/).map(x=>x.trim()).filter(Boolean);
  s.dayBoundary=+sBound.value; s.termStart=sTerm.value;
  save(); closeAny(); buildTimeline();
}

/* classes */
function openClasses(){
  closeMenu();
  renderClassesModal();
  document.getElementById('classesBg').classList.add('open');
}
function renderClassesModal(){
  const rows=DB.classes.map(c=>`<div class="list-row"><span>${c.title} — ${c.day} ${c.start}-${c.end} (${c.parity==='all'?'هرهفته':c.parity==='odd'?'فرد':'زوج'})</span>
    <span onclick="delClass('${c.id}')" style="cursor:pointer;color:var(--danger)">حذف</span></div>`).join('') || '<div class="empty">کلاسی ثبت نشده</div>';
  document.getElementById('classesModal').innerHTML=`<button class="close-x" onclick="closeAny()">×</button>
    <h3 style="margin-top:0">برنامه کلاسی</h3>
    <div>${rows}</div>
    <h3>افزودن کلاس</h3>
    <label>عنوان</label><input id="clTitle">
    <div class="row2"><div><label>روز</label><select id="clDay">${WD.map(d=>`<option>${d}</option>`).join('')}</select></div>
    <div><label>هفته</label><select id="clParity"><option value="all">هرهفته</option><option value="odd">فرد</option><option value="even">زوج</option></select></div></div>
    <div class="row2"><div><label>شروع</label><input type="time" id="clStart"></div><div><label>پایان</label><input type="time" id="clEnd"></div></div>
    <div class="actions"><button class="save-btn" onclick="addClass()">افزودن</button>
    <button class="cancel-btn" onclick="closeAny()">بستن</button></div>`;
}
function addClass(){
  const title=clTitle.value.trim(); if(!title) return;
  DB.classes.push({id:'c'+Date.now(),title,day:clDay.value,parity:clParity.value,start:clStart.value,end:clEnd.value});
  save(); renderClassesModal(); buildTimeline();
}
function delClass(id){ DB.classes=DB.classes.filter(c=>c.id!==id); save(); renderClassesModal(); buildTimeline(); }

/* backup */
function exportBackup(){
  const blob=new Blob([JSON.stringify(DB,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='planner-backup.json'; a.click();
}
function importBackup(ev){
  const f=ev.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{ try{ DB=JSON.parse(r.result); save(); buildTimeline(); alert('بازیابی شد'); }catch(e){ alert('فایل نامعتبر'); } };
  r.readAsText(f);
}

buildTimeline();
setInterval(buildTimeline, 60000);
