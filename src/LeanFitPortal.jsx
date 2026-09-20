import { useState, useRef, useCallback, useMemo, useEffect, Component } from "react";
import { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from "recharts";
import { 
  fetchMe,
  fetchClientData, 
  submitCheckIn, 
  submitMeasurement, 
  submitWin, 
  submitOnboarding, 
  registerOnboarding,
  getReportUploadUrl, 
  confirmReportUpload, 
  uploadFileToSignedUrl, 
  fetchCoachRoster, 
  fetchCoachClientDeepDive,
  updateCoachPlans, 
  updateCoachStatus, 
  updateCoachNotes,
  deleteCoachClientCheckin,
  setDemoUser
} from "./services/api";
import { auth, loginWithEmail, logoutUser } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";
import { LOGO_HIGHRES } from "./logo_base64";

export function getAdherencePct(adh) {
  if (adh === null || adh === undefined) return 0;
  if (typeof adh === "number") return adh;
  if (typeof adh === "object") {
    if (typeof adh.overall === "number") return adh.overall;
    if (typeof adh.meals === "number") return adh.meals;
  }
  const parsed = parseFloat(adh);
  return isNaN(parsed) ? 0 : Math.round(parsed);
}

/* ═══ THEMES ═══════════════════════════════════════════════ */
const THEMES = {
  dark:{ bg:"#060b16",c1:"#0a1524",c2:"#0e1c34",c3:"#122442",inp:"rgba(255,255,255,0.06)",inpBrd:"rgba(59,130,246,0.2)",brd:"rgba(59,130,246,0.14)",acc:"#3b82f6",accD:"#0f52ba",accG:"rgba(59,130,246,0.25)",g:"#22c55e",gG:"rgba(34,197,94,0.25)",am:"#f59e0b",amG:"rgba(245,158,11,0.2)",r:"#ef4444",rG:"rgba(239,68,68,0.2)",pur:"#0ea5e9",purG:"rgba(14,165,233,0.2)",t:"#ffffff",ts:"rgba(255,255,255,0.55)",tm:"rgba(255,255,255,0.25)",dark:true },
  light:{ bg:"#f0f4fc",c1:"#ffffff",c2:"#f5f8fe",c3:"#e8effa",inp:"rgba(255,255,255,0.95)",inpBrd:"rgba(15,82,186,0.25)",brd:"rgba(15,82,186,0.15)",acc:"#0f52ba",accD:"#0a3a8a",accG:"rgba(15,82,186,0.12)",g:"#16a34a",gG:"rgba(22,163,74,0.12)",am:"#b45309",amG:"rgba(180,83,9,0.12)",r:"#dc2626",rG:"rgba(220,38,38,0.12)",pur:"#0369a1",purG:"rgba(3,105,161,0.12)",t:"#0d1b3e",ts:"rgba(13,27,62,0.62)",tm:"rgba(13,27,62,0.35)",dark:false }
};

const PROTEIN_OPTS = ["Eggs","Chicken","Paneer","Whey Protein","Tofu","Fish","Red Meat","Greek Yoghurt","Soya Chunks","Edamame"];
const MEAS_PARTS = [
  {k:"mArms",l:"Arms",guide:"Flexed bicep, widest point, mid-upper arm"},
  {k:"mWaist",l:"Waist",guide:"Belly button level, normal exhale, relaxed"},
  {k:"mQuads",l:"Quads",guide:"Upper thigh, widest point, standing straight"},
  {k:"mChest",l:"Chest",guide:"Nipple line, normal breath, arms down at sides"},
  {k:"mShoulders",l:"Shoulders",guide:"Widest point across both deltoids, arms relaxed"},
  {k:"mHips",l:"Hips",guide:"Widest point around the buttocks, feet together"},
  {k:"mNeck",l:"Neck",guide:"Just below the Adam's apple, level all around"},
];
const MEAL_LABELS = ["","Off Plan","Mostly Off","Mixed","Mostly On","Perfect"];
const MEAL_COLORS = ["","#ef4444","#f97316","#eab308","#84cc16","#22c55e"];
const PAUSE_REASONS = ["Illness / Medical","Travel / Work Trip","Personal / Family","Client Request","Other"];
const CALENDLY_LINK = "https://cal.com/ramdixit/discovery-call"; // TODO: replace with Ram's real booking link
const REFERRAL_URL = "https://portal.leanfitnesswithram.com/join";

/* ═══ ADHERENCE FORMULA (Weighted + Proportional) ══════════
   Meals 40% · Steps 30% · Hydration 20% · Vitamins 10%
   Each metric is proportional not binary
═══════════════════════════════════════════════════════════ */
function calcAdh(data, stepsGoal) {
  if (!data.length) return {meals:0,steps:0,water:0,vitamins:0,overall:0};
  const avg = arr => arr.reduce((s,v)=>s+v,0)/arr.length;
  const mealS  = data.map(d => d.meals ? (d.meals/5)*100 : 0);
  const stepS  = data.map(d => Math.min(100,(d.steps/stepsGoal)*100));
  const waterS = data.map(d => Math.min(100,(d.water/3.0)*100));
  const vitS   = data.map(d => d.multi ? 100 : 0);
  const meals=Math.round(avg(mealS)), steps=Math.round(avg(stepS)), water=Math.round(avg(waterS)), vitamins=Math.round(avg(vitS));
  const overall = Math.round(meals*0.4 + steps*0.3 + water*0.2 + vitamins*0.1);
  return {meals,steps,water,vitamins,overall};
}
function clientAlerts(c) {
  if (!c) return [];
  const a=[];
  const daysSince = c.daysSince ?? 0;
  if (c.status==="paused") a.push({lvl:"am",msg:"Programme paused"});
  else if (daysSince>=2) a.push({lvl:"r",msg:`${daysSince} days without check-in`});
  else if (!c.checkedIn) a.push({lvl:"am",msg:"Not checked in today"});
  if (c.latestMeals != null && c.latestMeals<=2) a.push({lvl:"am",msg:`Meals ${c.latestMeals}/5`});
  const stepsGoal = c.coachStepsGoal || 8000;
  if (c.latestSteps != null && c.latestSteps < stepsGoal*0.5) a.push({lvl:"am",msg:`Steps very low (${c.latestSteps})`});
  if (c.latestStress != null && c.latestStress>=8) a.push({lvl:"am",msg:`Stress ${c.latestStress}/10`});
  if (c.latestWater != null && c.latestWater<1.5) a.push({lvl:"am",msg:"Hydration critical"});
  return a;
}
/* DRAFT traffic-light classification — starting point only, to be refined together.
   Green: consistently checking in, adherence high, streak intact.
   Yellow: check-ins/adherence slipping but still engaged.
   Red: barely or not checking in, no real progress, effectively inactive. */
function trafficLight(c) {
  if (!c) return "am";
  if (c.status==="paused") return "am";
  const adh = getAdherencePct(c.adherence);
  const daysSince = c.daysSince ?? 0;
  const streak = c.streak ?? 0;
  if (daysSince>=3 || streak===0 || adh<45) return "r";
  if (daysSince>=1 || adh<75 || streak<4) return "am";
  return "g";
}
const TL_LABEL={g:"Green",am:"Yellow",r:"Red"};
function calcBF(waistCm,neckCm,heightCm) {
  if (!waistCm||!neckCm||!heightCm||+waistCm<=+neckCm) return null;
  const hI=+heightCm/2.54,nI=+neckCm/2.54,wI=+waistCm/2.54;
  return Math.max(3,86.010*Math.log10(wI-nI)-70.041*Math.log10(hI)+36.76).toFixed(1);
}
function toUnit(kg,unit) { return unit==="lbs"?+(kg*2.20462).toFixed(1):kg; }
function fromUnit(val,unit) { return unit==="lbs"?+(parseFloat(val)/2.20462).toFixed(2):parseFloat(val); }
function filterData(data,f) { if(f==="1W")return data.slice(-7);if(f==="2W")return data.slice(-14);if(f==="1M")return data.slice(-30);return data; }

/* ═══ ICONS ═════════════════════════════════════════════════ */
const Ic = {
  CheckIn: ({c,sz=22}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12l2 2 4-4"/></svg>,
  Progress: ({c,sz=22}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  Body: ({c,sz=22}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="2.5"/><path d="M7.5 9.5h9L15 15H9z"/><path d="M9 15l-2 6M15 15l2 6"/></svg>,
  Wins: ({c,sz=22}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v4M8 21h8"/><path d="M5 4h14s.5 5.5-2.5 8.5C15 14 13.5 14.5 12 14.5s-3-.5-4.5-2C4.5 9.5 5 4 5 4z"/><path d="M5 4H2.5s-.5 4 2 5.5M19 4h2.5s.5 4-2 5.5"/></svg>,
  Me: ({c,sz=22}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6"/></svg>,
  Sun: ({c,sz=16}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2} strokeLinecap="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  Moon: ({c,sz=16}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2} strokeLinecap="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
  Camera: ({c,sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>,
  Lock: ({c,sz=14}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
  Mail: ({c,sz=16}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
  Chevron: ({c,sz=14,dir="right"}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2} strokeLinecap="round" style={{transform:dir==="left"?"rotate(180deg)":dir==="down"?"rotate(90deg)":"none"}}><polyline points="9 18 15 12 9 6"/></svg>,
  Coach: ({c,sz=22}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>,
  History: ({c,sz=22}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>,
  Share: ({c,sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
  Refer: ({c,sz=24}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.6} strokeLinecap="round"><circle cx="9" cy="9" r="4"/><circle cx="20" cy="7" r="3"/><path d="M3 22a6 6 0 0112 0M14.5 17.5a5 5 0 019 2.5"/></svg>,
  Pause: ({c,sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2} strokeLinecap="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>,
  Play: ({c,sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2} strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  Alert: ({c,sz=16}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2} strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  Notes: ({c,sz=22}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  SaladBowl: ({c,sz=24}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M4 11C4 17.627 7.582 22 12 22C16.418 22 20 17.627 20 11"/><line x1="3" y1="11" x2="21" y2="11"/><path d="M12 11C11.5 8.5 9.5 6.5 8 5.5C8 8 9.5 10 12 11"/><path d="M12 11C12.5 8.5 14.5 6.5 16 5.5C16 8 14.5 10 12 11"/><line x1="12" y1="5.5" x2="12" y2="11"/></svg>,
  Dumbbell: ({c,sz=24}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="9" width="3.5" height="6" rx="1.5"/><rect x="5.5" y="10.5" width="2.5" height="3" rx="0.8"/><line x1="8" y1="12" x2="16" y2="12"/><rect x="16" y="10.5" width="2.5" height="3" rx="0.8"/><rect x="18.5" y="9" width="3.5" height="6" rx="1.5"/></svg>,
  BloodReport: ({c,sz=24}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.6} strokeLinecap="round"><path d="M12 3C12 3 5 10 5 16a7 7 0 0014 0C19 10 12 3 12 3z"/><path d="M8 18a4.5 4.5 0 006.5-3"/></svg>,
  ProgressPhotos: ({c,sz=24}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.6} strokeLinecap="round"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M7 7V5a2 2 0 014 0v2M2 12h20"/><circle cx="12" cy="17" r="3"/></svg>,
  OnboardForm: ({c,sz=24}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.6} strokeLinecap="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>,
  Plus: ({c,sz=24}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2.5} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Bell: ({c,sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>,
  Fork: ({c,sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v7a2 2 0 002 2h0a2 2 0 002-2V2M5 11v11M15 2c-1.5 0-3 2-3 5s1 5 3 5 3-2 3-5-1.5-5-3-5zM15 12v11"/></svg>,
  Footprint: ({c,sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M8 4c-2 0-3 2-3 4.5S6 13 6 16a2.5 2.5 0 005 0c0-2-1-3-1-6.5C10 6.5 10 4 8 4z"/><path d="M17 9c-2 0-3 1.5-3 3.5S15 16 15 18a2.5 2.5 0 005 0c0-1.5-.5-2-.5-4.5C19.5 11 19 9 17 9z"/></svg>,
  Droplet: ({c,sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.5C12 2.5 5.5 10.5 5.5 15a6.5 6.5 0 0013 0C18.5 10.5 12 2.5 12 2.5z"/></svg>,
  Pill: ({c,sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="9" width="18" height="8" rx="4" transform="rotate(-35 12 12)"/><line x1="12" y1="7.5" x2="12" y2="16.5" transform="rotate(-35 12 12)"/></svg>,
  Upload: ({c,sz=20}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  FilePdf: ({c,sz=22}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><text x="7" y="18" fontSize="6" fontWeight="900" fill={c} stroke="none">PDF</text></svg>,
  Calendar: ({c,sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  Trash: ({c,sz=16}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>,
  Check: ({c,sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
};

/* ═══ CONFETTI (lightweight CSS burst, no deps) ═══════════════ */
function Confetti({D}) {
  const colors=[D.acc,D.g,D.am,D.pur,D.r];
  const pieces=Array.from({length:36},(_,i)=>({
    left:Math.random()*100,
    delay:Math.random()*0.4,
    dur:1.6+Math.random()*1.2,
    rot:Math.random()*360,
    c:colors[i%colors.length],
    sz:5+Math.random()*5,
  }));
  return <>
    <style>{`
      @keyframes confettiFall { 0%{transform:translateY(-20px) rotate(0deg);opacity:1;} 100%{transform:translateY(420px) rotate(600deg);opacity:0;} }
      @keyframes popIn { 0%{transform:scale(0);opacity:0;} 60%{transform:scale(1.15);opacity:1;} 100%{transform:scale(1);} }
    `}</style>
    <div style={{position:"absolute",top:0,left:0,right:0,height:0,overflow:"visible",pointerEvents:"none",zIndex:0}}>
      {pieces.map((p,i)=>(
        <div key={i} style={{position:"absolute",left:`${p.left}%`,top:0,width:p.sz,height:p.sz*0.5,background:p.c,borderRadius:1,animation:`confettiFall ${p.dur}s ease-in ${p.delay}s 1 forwards`,transform:`rotate(${p.rot}deg)`}}/>
      ))}
    </div>
  </>;
}

/* ═══ RING GAUGE (chunky rounded progress ring, per reference UI) ═══ */
function RingGauge({D, pct=0, size=150, stroke=16, color, trackColor, label, sub}) {
  const r=(size-stroke)/2, c=r*2*Math.PI, off=c-(Math.min(100,Math.max(0,pct))/100)*c;
  const ringColor = color||D.g;
  return (
    <div style={{position:"relative",width:size,height:size,margin:"0 auto"}}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{transform:"rotate(-90deg)"}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={trackColor||(D.dark?"rgba(255,255,255,0.08)":D.brd)} strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={ringColor} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{transition:"stroke-dashoffset 0.6s ease"}}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <div style={{fontSize:size*0.24,fontWeight:900,color:D.t,letterSpacing:"-0.5px"}}>{label}</div>
        {sub && <div style={{fontSize:size*0.075,color:D.ts,fontWeight:600,marginTop:2,textAlign:"center"}}>{sub}</div>}
      </div>
    </div>
  );
}

const LOGO_IMG = LOGO_HIGHRES;

/* ═══ PROPER DATE FORMATTER (Change #5) ═══════════════════════ */
function formatDisplayDate(dateStr) {
  if (!dateStr) return "";
  const clean = String(dateStr).trim();
  if (/^\d{1,2}(st|nd|rd|th)?\s+[A-Za-z]+(\s+\d{4})?$/.test(clean)) return clean;

  const stripped = clean.replace(/^0+/, "");
  let day, month, year;

  if (stripped.includes("/") && stripped.includes("-")) {
    const [dm, y] = stripped.split("-");
    const [d, m] = dm.split("/");
    day = parseInt(d, 10);
    month = parseInt(m, 10);
    year = parseInt(y, 10);
  } else if (stripped.includes("-")) {
    const parts = stripped.split("-");
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        year = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
        day = parseInt(parts[2], 10);
      } else {
        day = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
        year = parseInt(parts[2], 10);
      }
    }
  } else if (stripped.includes("/")) {
    const [d, m] = stripped.split("/");
    day = parseInt(d, 10);
    month = parseInt(m, 10);
    year = 2026;
  }

  if (!day || !month || isNaN(day) || isNaN(month)) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      day = d.getDate();
      month = d.getMonth() + 1;
      year = d.getFullYear();
    } else {
      return dateStr;
    }
  }

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const monthName = months[month - 1] || "";
  const getOrdinal = (n) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  return `${getOrdinal(day)} ${monthName} ${year || 2026}`;
}

/* ═══ LF LOGO ════════════════════════════════════════════════ */
function LFLogo({D,compact=false}) {
  if (compact) return (
    <div style={{background:"white",borderRadius:8,padding:"3px 8px",display:"inline-flex",alignItems:"center",boxShadow:"0 1px 4px rgba(0,0,0,0.15)"}}>
      <img src={LOGO_IMG} alt="LeanFit" style={{height:18,width:"auto",display:"block"}}/>
    </div>
  );
  return (
    <div style={{background:"white",borderRadius:14,padding:"8px 18px",display:"inline-flex",alignItems:"center",boxShadow:"0 4px 20px rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.2)"}}>
      <img src={LOGO_IMG} alt="LeanFit Health & Lifestyle" style={{height:40,width:"auto",display:"block"}}/>
    </div>
  );
}
function _LFLogoOLD({D,compact=false}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:compact?6:10}}>
      <svg width={compact?26:34} height={compact?19:24} viewBox="0 0 34 24">
        <defs><linearGradient id="lfg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#60a5fa"/><stop offset="100%" stopColor="#1a56db"/></linearGradient></defs>
        <rect x=".5" y=".5" width="5" height="19" rx="2" fill="url(#lfg)"/>
        <rect x=".5" y="14.5" width="13" height="5" rx="2" fill="url(#lfg)"/>
        <rect x="17.5" y=".5" width="5" height="19" rx="2" fill="url(#lfg)"/>
        <rect x="17.5" y=".5" width="14" height="5" rx="2" fill="url(#lfg)"/>
        <rect x="17.5" y="9" width="10.5" height="4.5" rx="2" fill="url(#lfg)"/>
      </svg>
      {!compact && <div>
        <div style={{fontSize:12.5,fontWeight:900,letterSpacing:2.8,lineHeight:1}}><span style={{color:D.t}}>LEAN</span><span style={{color:D.acc}}>FIT</span></div>
        <div style={{fontSize:6,color:D.ts,letterSpacing:2,marginTop:2.5}}>HEALTH & LIFESTYLE</div>
      </div>}
    </div>
  );
}

/* ═══ SHARED UI ══════════════════════════════════════════════ */
function GCard({children,D,style,glowColor,pad=16,onClick}) {
  return <div onClick={onClick} style={{background:D.c1,borderRadius:22,border:D.dark?`1px solid ${D.brd}`:"none",padding:pad,boxShadow:glowColor?`0 0 14px ${glowColor},0 6px 18px rgba(13,37,35,${D.dark?.45:.07})`:`0 4px 16px rgba(13,37,35,${D.dark?.35:.06})`,...style}}>{children}</div>;
}
function SL({children,D,color}) { return <div style={{fontSize:9.5,color:color||D.acc,fontWeight:700,letterSpacing:1.8,textTransform:"uppercase",marginBottom:11}}>{children}</div>; }
function Ti({D,value,onChange,placeholder,type="text",style}) { return <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${D.inpBrd}`,background:D.inp,color:D.t,fontSize:14,outline:"none",boxSizing:"border-box",...style}}/>; }
function Ta({D,value,onChange,placeholder,rows=4}) { return <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${D.inpBrd}`,background:D.inp,color:D.t,fontSize:13,outline:"none",resize:"vertical",lineHeight:1.6,fontFamily:"-apple-system,system-ui,sans-serif",boxSizing:"border-box"}}/>; }
function Tog3({D,options,value,onChange}) { return <div style={{display:"flex",gap:6}}>{options.map(o=><button key={o} onClick={()=>onChange(o)} style={{flex:1,padding:"10px 0",borderRadius:10,border:`2px solid ${value===o?D.acc:D.brd}`,background:value===o?D.accG:"transparent",color:value===o?D.acc:D.ts,fontWeight:700,fontSize:12,cursor:"pointer"}}>{o}</button>)}</div>; }
function BtnGrp({D,options,value,onChange}) { return <div style={{display:"flex",flexWrap:"wrap",gap:7}}>{options.map(o=><button key={o} onClick={()=>onChange(o)} style={{padding:"8px 14px",borderRadius:8,border:`2px solid ${value===o?D.acc:D.brd}`,background:value===o?D.accG:"transparent",color:value===o?D.acc:D.ts,fontWeight:value===o?700:400,fontSize:12,cursor:"pointer"}}>{o}</button>)}</div>; }
function FilterBar({D,value,onChange}) { return <div style={{display:"flex",gap:4,marginBottom:12}}>{["1W","2W","1M","All"].map(f=><button key={f} onClick={()=>onChange(f)} style={{padding:"5px 12px",borderRadius:20,border:`1.5px solid ${value===f?D.acc:D.brd}`,background:value===f?D.accG:"transparent",color:value===f?D.acc:D.ts,fontSize:10,fontWeight:value===f?700:400,cursor:"pointer"}}>{f}</button>)}</div>; }
function TT({D}) { return ({active,payload,label}) => !active||!payload?.length?null:<div style={{background:D.c2,border:`1px solid ${D.brd}`,borderRadius:8,padding:"8px 12px",fontSize:11,color:D.t}}><div style={{color:D.ts,marginBottom:3}}>{label}</div>{payload.map((p,i)=><div key={i} style={{color:p.color||D.t,fontWeight:600,marginTop:1}}>{p.name}: {typeof p.value==="number"?p.value.toFixed(1):p.value}</div>)}</div>; }

// ── Water Slider (0 – 4 L in 0.5 L steps) ────────────────
function WaterSlider({D, value, onChange}) {
  const min=0, max=4, step=0.5;
  const pct = (value-min)/(max-min)*100;
  const ticks = [0,0.5,1,1.5,2,2.5,3,3.5,4];
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <span style={{fontSize:12,color:D.ts}}>Water Intake</span>
        <div style={{display:"flex",alignItems:"baseline",gap:3}}>
          <span style={{fontSize:24,fontWeight:900,color:value>=3?D.g:value>=2?D.acc:D.am}}>{value}</span>
          <span style={{fontSize:12,color:D.ts}}>L</span>
        </div>
      </div>
      <div style={{position:"relative",paddingBottom:22}}>
        {/* Track */}
        <div style={{height:5,borderRadius:3,background:D.brd,position:"relative",overflow:"visible"}}>
          <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,${D.am},${D.acc},${D.g})`,borderRadius:3,transition:"width 0.1s"}}/>
        </div>
        {/* Invisible range input */}
        <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(+e.target.value)}
          style={{position:"absolute",top:-6,left:0,width:"100%",height:18,opacity:0,cursor:"pointer",zIndex:2}}/>
        {/* Custom thumb */}
        <div style={{position:"absolute",top:-8,left:`${pct}%`,transform:"translateX(-50%)",width:20,height:20,borderRadius:"50%",background:value>=3?D.g:value>=2?D.acc:D.am,boxShadow:`0 0 8px ${D.accG}`,border:`2px solid ${D.bg}`,zIndex:1,pointerEvents:"none"}}/>
        {/* Tick labels */}
        <div style={{position:"absolute",top:14,left:0,right:0,display:"flex",justifyContent:"space-between"}}>
          {ticks.map(t=>(
            <div key={t} style={{textAlign:"center",width:0,overflow:"visible"}}>
              <span style={{fontSize:8,color:t===value?D.acc:D.tm,fontWeight:t===value?700:400,whiteSpace:"nowrap"}}>
                {Number.isInteger(t)?`${t}L`:""}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Validation helper ─────────────────────────────────────
function validateCheckIn(form, isMeasDay, measForm) {
  const errors = [];
  if (!form.w) errors.push("Today's Weight");
  if (form.meals===null) errors.push("Meal Rating (1–5)");
  if (form.multi===null) errors.push("Multivitamin");
  if (!form.steps) errors.push("Step Count");
  if (form.wrk===null) errors.push("Workouts Completed");
  // Weekly measurements and photos are optional as per client preference
  return errors;
}

/* ═══ CHECK-IN SCREEN (V6) ═══════════════════════════════════ */
function CheckIn({D, data, setData, onComplete, weightUnit, setWeightUnit, measUnit, clientProfile}) {
  const [form, setForm] = useState({w:"",e:7,sl:7,st:3,steps:"",wrk:null,water:2.5,meals:null,mealNote:"",multi:null,bed:"23:00",wake:"07:00",note:""});
  const [pendingUnit, setPendingUnit] = useState("kg");
  const [measForm, setMeasForm] = useState({mArms:"",mWaist:"",mQuads:"",mChest:"",mShoulders:"",mHips:"",mNeck:""});
  const [photos, setPhotos] = useState({Front:null,Side:null,Back:null});
  const [errors, setErrors] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const F=(k,v)=>setForm(p=>({...p,[k]:v}));
  const MF=(k,v)=>setMeasForm(p=>({...p,[k]:v}));
  const handlePhoto=(slot,file)=>{if(!file)return;const r=new FileReader();r.onload=ev=>setPhotos(p=>({...p,[slot]:ev.target.result}));r.readAsDataURL(file);};

  // Schedule logic:
  // - Body measurements every 7 days (e.g. Day 8, 15, 22...)
  // - Progress photos every 14 days (e.g. Day 15, 29, 43...)
  // - Reminders appear 3 days prior to due day
  const dayCount = data.length + 1;
  const daysUntilMeas = ((7 - ((dayCount - 1) % 7)) % 7);
  const isMeasDay = daysUntilMeas === 0;
  const showMeasReminder = !isMeasDay && daysUntilMeas <= 3;
  const [showMeasSection, setShowMeasSection] = useState(isMeasDay);

  const daysUntilPhoto = ((14 - ((dayCount - 1) % 14)) % 14);
  const isPhotoDay = daysUntilPhoto === 0;
  const showPhotoReminder = !isPhotoDay && daysUntilPhoto <= 3;
  const [showPhotoSection, setShowPhotoSection] = useState(isPhotoDay);

  const unit = weightUnit||pendingUnit;
  const startW = clientProfile?.startW ?? null;
  const startDisp = startW ? toUnit(startW, unit) : "—";
  const daysIntoWeek = (dayCount - 1) % 7; // 0 = first day of a new week → workout count resets
  const thisWeekData = daysIntoWeek>0 ? data.slice(-daysIntoWeek) : [];
  const weekWorkouts = thisWeekData.length>0?Math.max(...thisWeekData.map(d=>d.wrk??0)):0;
  const diff = (form.w && startW) ? +(startW-fromUnit(form.w,unit)).toFixed(2) : null;
  const curWeek = Math.max(1, Math.ceil(dayCount / 7));
  const effUnit = measUnit||"cm";
  const waistCm = effUnit==="inches"?+(+measForm.mWaist*2.54).toFixed(1):measForm.mWaist;
  const neckCm  = effUnit==="inches"?+(+measForm.mNeck*2.54).toFixed(1):measForm.mNeck;
  const autoBF  = calcBF(waistCm,neckCm,clientProfile?.height ?? 175);

  const submit = async () => {
    const errs = validateCheckIn(form, isMeasDay, measForm);
    if (errs.length) { setErrors(errs); window.scrollTo(0,0); return; }
    setErrors([]);
    setSubmitError("");
    setSubmitting(true);
    const storedW = fromUnit(form.w, unit);
    if (!weightUnit&&pendingUnit) setWeightUnit(pendingUnit);
    
    // Standardized DD-MM-YYYY format across all countries
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const fullDate = `${pad(now.getDate())}-${pad(now.getMonth()+1)}-${now.getFullYear()}`;
    const displayDate = `${now.getDate()}/${now.getMonth()+1}`;

    const entry = {
      date: displayDate,
      fullDate,
      w: storedW,
      e: form.e,
      sl: form.sl,
      st: form.st,
      steps: +form.steps,
      wrk: form.wrk??weekWorkouts,
      water: form.water,
      meals: form.meals,
      mealNote: form.meals<=3?form.mealNote:"",
      multi: form.multi===true,
      note: form.note,
      photos: (isPhotoDay || showPhotoSection) ? photos : null
    };

    try {
      await submitCheckIn(entry);
    } catch (err) {
      console.error("Backend checkin sync:", err.message);
      setSubmitError(err.message || "Failed to submit check-in. Please try again.");
      setSubmitting(false);
      window.scrollTo(0,0);
      return;
    }

    if ((isMeasDay || showMeasSection) && (measForm.mWaist || measForm.mArms || measForm.mChest || photos.Front)) {
      try {
        await submitMeasurement({
          week: curWeek,
          date: fullDate,
          arms: measForm.mArms ? +measForm.mArms : null,
          waist: measForm.mWaist ? +measForm.mWaist : null,
          quads: measForm.mQuads ? +measForm.mQuads : null,
          chest: measForm.mChest ? +measForm.mChest : null,
          shoulders: measForm.mShoulders ? +measForm.mShoulders : null,
          hips: measForm.mHips ? +measForm.mHips : null,
          neck: measForm.mNeck ? +measForm.mNeck : null
        });
      } catch (err) {
        console.warn("Backend measurement sync:", err.message);
      }
    }

    setSubmitting(false);
    setData(d=>[...d,entry]);
    setSubmitted(true);
  };

  if (submitted) return (
    <div style={{padding:24,position:"relative",overflow:"hidden"}}>
      <Confetti D={D}/>
      <div style={{textAlign:"center",marginBottom:20,position:"relative",zIndex:1}}>
        <div style={{width:72,height:72,borderRadius:"50%",background:D.gG,border:`2px solid ${D.g}`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",animation:"popIn 0.5s cubic-bezier(0.34,1.56,0.64,1)"}}>
          <Ic.Check c={D.g} sz={32}/>
        </div>
        <div style={{fontSize:13,color:D.ts,marginBottom:6}}>Day {dayCount} · {clientProfile?.phase || "Phase I"} · {new Date().toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</div>
        <div style={{fontSize:22,fontWeight:900,color:D.t,letterSpacing:"-0.5px"}}>Check-In Logged!</div>
        <div style={{fontSize:13,color:D.ts,marginTop:6}}>That consistency is exactly what compounds into results.</div>
      </div>
      <button onClick={onComplete} style={{width:"100%",padding:15,background:D.acc,border:"none",borderRadius:14,fontSize:14,fontWeight:700,color:"white",cursor:"pointer",boxShadow:`0 0 24px ${D.accG}`,position:"relative",zIndex:1}}>
        View My Dashboard →
      </button>
    </div>
  );

  return (
    <div style={{padding:"16px 16px 24px"}}>
      {/* Submit error banner */}
      {submitError && (
        <GCard D={D} style={{marginBottom:12,padding:14,background:D.rG,border:`1.5px solid ${D.r}`}}>
          <div style={{fontSize:12,color:D.r,fontWeight:700,display:"flex",alignItems:"center",gap:6}}>
            <Ic.Alert c={D.r} sz={16}/>
            <span>{submitError}</span>
          </div>
        </GCard>
      )}

      {/* Validation errors */}
      {errors.length>0 && (
        <GCard D={D} style={{marginBottom:12,padding:14,background:D.rG,border:`1px solid ${D.r}50`}}>
          <div style={{fontSize:11,color:D.r,fontWeight:700,marginBottom:6}}>Please complete the following fields:</div>
          {errors.map(e=><div key={e} style={{fontSize:11,color:D.r,marginBottom:2}}>• {e}</div>)}
        </GCard>
      )}

      {/* TODAY'S WEIGHT */}
      <GCard D={D} glowColor={D.accG} style={{marginBottom:12,padding:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <SL D={D}>Today's Weight</SL>
          {!weightUnit
            ? <div style={{display:"flex",gap:5}}>{["kg","lbs"].map(u=><button key={u} onClick={()=>setPendingUnit(u)} style={{padding:"5px 12px",borderRadius:20,border:`2px solid ${pendingUnit===u?D.acc:D.brd}`,background:pendingUnit===u?D.accG:"transparent",color:pendingUnit===u?D.acc:D.ts,fontWeight:700,fontSize:11,cursor:"pointer"}}>{u}</button>)}</div>
            : <div style={{display:"flex",alignItems:"center",gap:5,padding:"5px 12px",background:D.accG,borderRadius:20,border:`1px solid ${D.brd}`}}><span style={{fontSize:12,fontWeight:700,color:D.acc}}>{weightUnit}</span><Ic.Lock c={D.acc} sz={11}/></div>
          }
        </div>
        <style>{`.lf-weight-input::placeholder{font-size:14px;font-weight:500;opacity:0.55;}`}</style>
        <input className="lf-weight-input" type="number" step={unit==="lbs"?"0.1":"0.05"} placeholder={`Enter in ${unit}  e.g. ${unit==="lbs"?"149.6":"67.5"}`} value={form.w} onChange={e=>F("w",e.target.value)}
          style={{width:"100%",background:D.inp,border:`1.5px solid ${errors.some(e=>e.includes("Weight"))?"#ef4444":form.w?D.acc:D.inpBrd}`,borderRadius:12,padding:14,fontSize:26,color:D.t,outline:"none",fontWeight:900,letterSpacing:"-0.5px",boxSizing:"border-box"}}/>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:10,fontSize:11}}>
          <span style={{color:D.tm}}>Start: {startDisp} {unit}</span>
          {diff!==null&&diff!==0&&<span style={{color:diff>0?D.g:D.am,fontWeight:700}}>{diff>0?`↓ ${diff} kg`:""}</span>}
        </div>
        {!weightUnit&&<div style={{marginTop:8,fontSize:10,color:D.tm}}>⚠ Select your unit once — locked after first check-in.</div>}
      </GCard>

      {/* LIFESTYLE METRICS */}
      <GCard D={D} style={{marginBottom:12}}>
        <SL D={D}>Lifestyle Metrics (Basis Yesterday)</SL>
        {[{k:"e",l:"Energy Level",left:"Low",right:"High",inv:false},{k:"sl",l:"Sleep Quality",left:"Bad",right:"Excellent",inv:false},{k:"st",l:"Stress Level",left:"Low",right:"High",inv:true}].map(({k,l,left,right,inv})=>{
          const v=form[k]; const c=inv?(v<=3?D.g:v<=6?D.am:D.r):(v>=8?D.g:v>=5?D.am:D.r);
          return <div key={k} style={{marginBottom:20}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:7}}>
              <span style={{fontSize:13,color:D.ts,fontWeight:500}}>{l}</span>
              <span style={{fontSize:14,fontWeight:700,color:c,background:`${c}18`,padding:"2px 12px",borderRadius:20}}>{v}/10</span>
            </div>
            <input type="range" min={1} max={10} value={v} onChange={e=>F(k,+e.target.value)} style={{width:"100%",accentColor:c,cursor:"pointer"}}/>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:5,fontSize:10,color:D.tm,fontWeight:500}}><span>{left}</span><span>{right}</span></div>
          </div>;
        })}
      </GCard>

      {/* ACTIVITY */}
      <GCard D={D} style={{marginBottom:12}}>
        <SL D={D}>Activity (Basis Yesterday)</SL>
        <div style={{marginBottom:16}}>
          <div style={{fontSize:12,color:errors.some(e=>e.includes("Step"))?D.r:D.ts,marginBottom:6}}>Step Count *</div>
          <input type="number" placeholder="e.g. 8700" value={form.steps} onChange={e=>F("steps",e.target.value)} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${errors.some(e=>e.includes("Step"))?D.r:D.inpBrd}`,background:D.inp,color:D.t,fontSize:16,fontWeight:700,outline:"none",boxSizing:"border-box"}}/>
        </div>
        <div>
          <div style={{fontSize:12,color:D.ts,marginBottom:8}}>Workouts Completed This Week *{weekWorkouts>0&&<span style={{color:D.tm,marginLeft:6}}>({weekWorkouts}+ logged)</span>}</div>
          <div style={{display:"flex",gap:6}}>{[0,1,2,3,4,5].map(n=>{const locked=n<weekWorkouts,active=form.wrk===n||(form.wrk===null&&n===weekWorkouts);return <button key={n} onClick={()=>!locked&&F("wrk",n)} disabled={locked} style={{flex:1,padding:"10px 0",borderRadius:10,border:`2px solid ${locked?"transparent":active?D.acc:D.brd}`,background:locked?"rgba(128,128,128,0.08)":active?D.accG:"transparent",color:locked?D.tm:active?D.acc:D.ts,fontWeight:700,fontSize:14,cursor:locked?"not-allowed":"pointer",opacity:locked?0.3:1}}>{n}</button>;})}
          </div>
        </div>
      </GCard>

      {/* NUTRITION */}
      <GCard D={D} style={{marginBottom:12}}>
        <SL D={D}>Nutrition And Hydration</SL>
        <div style={{marginBottom:16}}>
          <div style={{fontSize:12,color:errors.some(e=>e.includes("Meal"))?D.r:D.ts,marginBottom:8}}>Meals On Point Today (1–5) *</div>
          <div style={{display:"flex",gap:6}}>{[1,2,3,4,5].map(n=>{const c=MEAL_COLORS[n],sel=form.meals===n;return <button key={n} onClick={()=>F("meals",n)} style={{flex:1,padding:"12px 0",borderRadius:10,border:`2px solid ${sel?c:D.brd}`,background:sel?`${c}18`:"transparent",color:sel?c:D.ts,fontWeight:sel?700:400,fontSize:16,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>{n}{sel&&<span style={{fontSize:8,fontWeight:700,color:c,textTransform:"uppercase",letterSpacing:0.5}}>{MEAL_LABELS[n]}</span>}</button>;})}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:6,fontSize:9,color:D.tm}}><span>1 = Off Plan</span><span>5 = Perfect</span></div>
          {form.meals!==null && form.meals<=3 && (
            <div style={{marginTop:12,background:D.amG,borderRadius:10,padding:"12px 14px",border:`1px solid ${D.am}30`}}>
              <div style={{fontSize:11,color:D.am,fontWeight:700,marginBottom:8}}>What changed today? What did you have outside the plan?</div>
              <Ta D={D} value={form.mealNote} onChange={v=>F("mealNote",v)} placeholder="e.g. team dinner, skipped lunch, stress eating in the evening..." rows={2}/>
            </div>
          )}
        </div>
        <div style={{marginBottom:16}}>
          <div style={{fontSize:12,color:errors.some(e=>e.includes("Multivitamin"))?D.r:D.ts,marginBottom:8}}>Multivitamin Taken? *</div>
          <div style={{display:"flex",gap:8}}>{[{v:true,l:"Taken"},{v:false,l:"Skipped"}].map(({v,l})=><button key={l} onClick={()=>F("multi",v)} style={{flex:1,padding:"11px",borderRadius:10,border:`2px solid ${form.multi===v?v?D.acc:D.am:D.brd}`,background:form.multi===v?v?D.accG:D.amG:"transparent",color:form.multi===v?v?D.acc:D.am:D.ts,fontWeight:700,fontSize:13,cursor:"pointer"}}>{v?"💊 "+l:"— "+l}</button>)}</div>
        </div>
        {/* WATER DRAG SLIDER */}
        <WaterSlider D={D} value={form.water} onChange={v=>F("water",v)}/>
      </GCard>

      {/* SLEEP */}
      <GCard D={D} style={{marginBottom:12}}>
        <SL D={D}>Sleep Time And Wake-Up</SL>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {[["Bedtime","bed"],["Wake-Up","wake"]].map(([l,k])=><div key={k}><div style={{fontSize:11,color:D.ts,marginBottom:6}}>{l}</div><input type="time" value={form[k]} onChange={e=>F(k,e.target.value)} style={{width:"100%",padding:"10px",borderRadius:10,border:`1.5px solid ${D.inpBrd}`,background:D.inp,color:D.t,fontSize:14,outline:"none",boxSizing:"border-box"}}/></div>)}
        </div>
      </GCard>

      {/* ── 3-DAY PRIOR MEASUREMENT REMINDER ── */}
      {showMeasReminder && (
        <GCard D={D} glowColor={D.amG} style={{marginBottom:12,border:`1.5px solid ${D.am}50`,background:D.amG}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                <span style={{fontSize:13}}>⏳</span>
                <span style={{fontSize:11,fontWeight:800,color:D.am,textTransform:"uppercase",letterSpacing:1}}>
                  Measurement Day in {daysUntilMeas} Day{daysUntilMeas>1?"s":""}
                </span>
              </div>
              <div style={{fontSize:11.5,color:D.t,lineHeight:1.4}}>
                Your weekly measurement check-in is scheduled for <strong>Day {dayCount + daysUntilMeas}</strong>. Have your measuring tape ready!
              </div>
            </div>
            <button 
              type="button" 
              onClick={()=>setShowMeasSection(s=>!s)}
              style={{flexShrink:0,padding:"6px 11px",borderRadius:8,border:`1px solid ${D.am}80`,background:showMeasSection?D.am:"transparent",color:showMeasSection?"#000":D.am,fontSize:10,fontWeight:700,cursor:"pointer"}}
            >
              {showMeasSection ? "Hide ▲" : "Log Early ▼"}
            </button>
          </div>
        </GCard>
      )}

      {/* ── WEEKLY MEASUREMENTS — Visible every 7 days (or toggled early) ── */}
      {(isMeasDay || showMeasSection) && (
        <GCard D={D} glowColor={D.amG} style={{marginBottom:12}}>
          <div style={{background:D.amG,borderRadius:10,padding:"10px 14px",marginBottom:14,border:`1px solid ${D.am}30`}}>
            <div style={{fontSize:10,color:D.am,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:2}}>
              {isMeasDay ? "Weekly Measurement Day (Every 7 Days)" : "Early Measurement Entry"}
            </div>
            <div style={{fontSize:11,color:D.ts,lineHeight:1.5}}>
              This section is scheduled every 7 days. All 7 measurements are tracked to monitor inch loss.
            </div>
          </div>
          <SL D={D} color={D.am}>Body Measurements ({effUnit === "inches" ? "Track Every Inch Lost" : "Track Every Centimetre Lost"})</SL>
          <div style={{background:D.c2,borderRadius:10,padding:"6px 10px",marginBottom:14,border:`1px solid ${D.brd}`,display:"flex",alignItems:"center",gap:6}}>
            <Ic.Lock c={D.tm} sz={12}/>
            <span style={{fontSize:10,color:D.tm}}>Unit locked to <strong style={{color:D.ts}}>{effUnit}</strong> — set during onboarding</span>
          </div>
          {MEAS_PARTS.map(({k,l,guide})=>(
            <div key={k} style={{marginBottom:14}}>
              <div style={{fontSize:12,color:D.t,fontWeight:600,marginBottom:2}}>{l} ({effUnit}) *</div>
              <div style={{fontSize:10,color:D.ts,marginBottom:6,fontStyle:"italic"}}>{guide}</div>
              <Ti D={D} value={measForm[k]||""} onChange={v=>MF(k,v)} placeholder={`e.g. ${effUnit==="inches"?"12.5":"32"}`} type="number" style={{border:`1.5px solid ${errors.some(e=>e.includes(l))?D.r:D.inpBrd}`}}/>
            </div>
          ))}
          {autoBF && (
            <div style={{background:D.c2,borderRadius:12,padding:"12px 14px",marginTop:4,border:`1px solid ${D.brd}`}}>
              <div style={{fontSize:9,color:D.acc,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:6}}>Auto-Calculated Body Fat (US Military)</div>
              <div style={{fontSize:28,fontWeight:900,color:D.acc}}>{autoBF}%</div>
              <div style={{fontSize:10,color:D.ts,marginTop:4}}>Waist: {waistCm} cm | Neck: {neckCm} cm</div>
            </div>
          )}
        </GCard>
      )}

      {/* ── 3-DAY PRIOR PROGRESS PHOTO REMINDER ── */}
      {showPhotoReminder && (
        <GCard D={D} glowColor={D.purG} style={{marginBottom:12,border:`1.5px solid ${D.pur}50`,background:D.purG}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                <span style={{fontSize:13}}>📸</span>
                <span style={{fontSize:11,fontWeight:800,color:D.pur,textTransform:"uppercase",letterSpacing:1}}>
                  Progress Photos in {daysUntilPhoto} Day{daysUntilPhoto>1?"s":""}
                </span>
              </div>
              <div style={{fontSize:11.5,color:D.t,lineHeight:1.4}}>
                Your bi-weekly progress photos are due on <strong>Day {dayCount + daysUntilPhoto}</strong>. Take morning photos on an empty stomach.
              </div>
            </div>
            <button 
              type="button" 
              onClick={()=>setShowPhotoSection(s=>!s)}
              style={{flexShrink:0,padding:"6px 11px",borderRadius:8,border:`1px solid ${D.pur}80`,background:showPhotoSection?D.pur:"transparent",color:showPhotoSection?"#fff":D.pur,fontSize:10,fontWeight:700,cursor:"pointer"}}
            >
              {showPhotoSection ? "Hide ▲" : "Upload Early ▼"}
            </button>
          </div>
        </GCard>
      )}

      {/* ── BI-WEEKLY PROGRESS PHOTOS — Visible every 14 days (or toggled early) ── */}
      {(isPhotoDay || showPhotoSection) && (
        <GCard D={D} glowColor={D.purG} style={{marginBottom:12}}>
          <div style={{background:D.purG,borderRadius:10,padding:"10px 14px",marginBottom:14,border:`1px solid ${D.pur}30`}}>
            <div style={{fontSize:10,color:D.pur,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:2}}>
              {isPhotoDay ? "Bi-Weekly Progress Photos (Every 14 Days)" : "Early Progress Photos"}
            </div>
            <div style={{fontSize:11,color:D.ts,lineHeight:1.5}}>
              Upload Front, Side, and Back photos. Same time, same lighting, relaxed morning pose.
            </div>
          </div>
          <SL D={D} color={D.pur}>Progress Photos</SL>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {["Front","Side","Back"].map(v=>(
              <label key={v} style={{background:photos[v]?"transparent":D.c2,borderRadius:10,border:`2px dashed ${D.pur}40`,aspectRatio:"3/4",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer",overflow:"hidden",position:"relative"}}>
                {photos[v]
                  ? <img src={photos[v]} alt={v} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                  : <><Ic.Camera c={D.tm} sz={20}/><div style={{fontSize:10,color:D.tm}}>{v}</div></>}
                <input type="file" accept="image/*" onChange={e=>handlePhoto(v,e.target.files[0])} style={{display:"none"}}/>
                {photos[v] && <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(0,0,0,0.55)",color:"white",fontSize:9,textAlign:"center",padding:"3px 0"}}>{v}</div>}
              </label>
            ))}
          </div>
          <div style={{marginTop:10,fontSize:11,color:D.tm,textAlign:"center"}}>Morning · Empty Stomach · Relaxed Pose</div>
        </GCard>
      )}

      {/* ADDITIONAL NOTES */}
      <GCard D={D} style={{marginBottom:20}}>
        <SL D={D}>Additional Notes For Ram</SL>
        <Ta D={D} value={form.note} onChange={v=>F("note",v)} placeholder="Anything you want to share with Ram today? Struggling with something, feeling something different, a win you want to mention, travel coming up..." rows={3}/>
      </GCard>

      <button 
        onClick={submit} 
        disabled={submitting}
        style={{width:"100%",padding:17,background:submitting?D.brd:D.acc,border:"none",borderRadius:14,fontSize:15,fontWeight:700,color:"white",cursor:submitting?"not-allowed":"pointer",boxShadow:submitting?"none":`0 0 24px ${D.accG}`}}
      >
        {submitting ? "Submitting Check-In..." : "Submit Today's Check-In *"}
      </button>
      <div style={{textAlign:"center",marginTop:8,fontSize:10,color:D.tm}}>* All fields marked mandatory must be completed</div>
    </div>
  );
}

/* ═══ DASHBOARD (V6 — updated adherence + fixed arc) ═════════ */
function Dashboard({D, data, weightUnit, clientProfile}) {
  const [cf,setCf]=useState("2W");
  const fd=filterData(data,cf);
  const last=data[data.length-1];
  const startW=clientProfile?.startW ?? (data.length > 0 ? data[0].w : null);
  const bestW=data.length>0?Math.min(...data.map(d=>d.w)):startW;
  const totalLost=(startW && bestW)?+(startW-bestW).toFixed(2):0;
  const dayCount = data.length + 1;
  const curWeek = Math.max(1, Math.ceil(dayCount / 7));
  const totalWeeks = clientProfile?.phaseWeeks || 12;
  const phasePct=Math.round((curWeek/totalWeeks)*100);
  const arcLen=Math.PI*80; const arcFill=(phasePct/100)*arcLen;
  const unit=weightUnit||"kg";
  const stepsGoal = clientProfile?.coachStepsGoal || 8000;
  const adh=calcAdh(data, stepsGoal);
  const chartData=fd.map(d=>({...d,w:toUnit(d.w,unit)}));
  const TT2=TT({D});

  return <div style={{padding:"16px 14px 24px"}}>
    <div style={{marginBottom:16}}><div style={{fontSize:9.5,color:D.acc,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>{clientProfile?.phase || "Phase I"} · Week {curWeek} of {totalWeeks}</div><div style={{fontSize:21,fontWeight:900,color:D.t}}>Progress Dashboard</div></div>

    {/* Phase arc — thick rounded ring, reference style */}
    <GCard D={D} glowColor={D.gG} style={{marginBottom:12,textAlign:"center",padding:20}}>
      <SL D={D}>Phase Progress — {clientProfile?.phase || "Phase I"}</SL>
      <svg width="200" height="130" viewBox="0 0 200 130" style={{display:"block",margin:"0 auto"}}>
        <path d="M 20 108 A 80 80 0 0 1 180 108" fill="none" stroke={D.dark?"rgba(255,255,255,0.08)":D.brd} strokeWidth="16" strokeLinecap="round"/>
        <path d="M 20 108 A 80 80 0 0 1 180 108" fill="none" stroke={D.g} strokeWidth="16" strokeLinecap="round" strokeDasharray={`${arcFill} ${arcLen}`}/>
        {/* WEEK label + number with clear space */}
        <text x="100" y="82" textAnchor="middle" fill={D.ts} fontSize="9" fontWeight="600" letterSpacing="2" style={{fontFamily:"-apple-system,system-ui"}}>WEEK</text>
        <text x="100" y="106" textAnchor="middle" fill={D.t} fontSize="28" fontWeight="900" style={{fontFamily:"-apple-system,system-ui"}}>{curWeek}</text>
        {/* Legends inside viewBox */}
        <text x="16" y="126" textAnchor="start" fill={D.tm} fontSize="9">Wk 1</text>
        <text x="184" y="126" textAnchor="end" fill={D.tm} fontSize="9">Wk {totalWeeks}</text>
      </svg>
      <div style={{display:"flex",justifyContent:"center",gap:20,marginTop:4}}>
        {[{v:`↓ ${toUnit(totalLost,unit)} ${unit}`,l:"Best Loss",c:D.g},{v:`${data.length}`,l:"Check-Ins",c:D.am},{v:`${Math.round((data.reduce((s,d)=>s+d.steps,0))/Math.max(1,data.length)).toLocaleString()}`,l:"Avg Steps",c:D.pur}].map(s=>(
          <div key={s.l} style={{textAlign:"center"}}><div style={{fontSize:16,fontWeight:900,color:s.c}}>{s.v}</div><div style={{fontSize:9,color:D.ts,fontWeight:600,letterSpacing:0.8,textTransform:"uppercase",marginTop:2}}>{s.l}</div></div>
        ))}
      </div>
    </GCard>

    {/* Phase timeline */}
    <GCard D={D} style={{marginBottom:12,padding:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div style={{fontSize:11,color:D.t,fontWeight:600}}>Phase Timeline</div><div style={{fontSize:10,color:D.acc,fontWeight:700}}>Week {curWeek} of {totalWeeks}</div></div>
      <div style={{height:6,background:D.brd,borderRadius:3,overflow:"hidden",marginBottom:6}}><div style={{height:"100%",width:`${phasePct}%`,background:`linear-gradient(90deg,${D.acc},${D.g})`,borderRadius:3}}/></div>
      <div style={{display:"flex",justifyContent:"space-between"}}>{[0,4,8,12].filter(i=>i<=totalWeeks).map(i=><div key={i} style={{textAlign:"center"}}><div style={{width:1,height:4,background:D.brd,margin:"0 auto 3px"}}/><div style={{fontSize:8,color:i<=curWeek?D.acc:D.tm,fontWeight:i===curWeek?700:400}}>W{i}</div></div>)}</div>
    </GCard>

    {/* Adherence — 4 metrics + weights */}
    <GCard D={D} style={{marginBottom:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <RingGauge D={D} pct={adh.overall} size={64} stroke={9} color={adh.overall>=80?D.g:adh.overall>=60?D.am:D.r} label={`${adh.overall}%`}/>
          <SL D={D} style={{marginBottom:0}}>Overall Adherence</SL>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:12}}>
        {[{l:"Meals",v:adh.meals,c:D.g,s:"avg daily rating",Icon:Ic.Fork},{l:"Steps",v:adh.steps,c:D.pur,s:"proportional to goal",Icon:Ic.Footprint},{l:"Hydration",v:adh.water,c:"#0284c7",s:"vs 3L target",Icon:Ic.Droplet},{l:"Vitamins",v:adh.vitamins,c:D.acc,s:"days taken",Icon:Ic.Pill}].map(({l,v,c,s,Icon})=>(
          <div key={l} style={{background:D.c2,borderRadius:10,padding:"10px 12px",border:`1px solid ${D.brd}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}><div style={{display:"flex",alignItems:"center",gap:6}}><Icon c={c} sz={14}/><div style={{fontSize:11,color:D.ts,fontWeight:600}}>{l}</div></div><div style={{fontSize:13,fontWeight:700,color:c}}>{v}%</div></div>
            <div style={{height:4,background:D.brd,borderRadius:2,overflow:"hidden",marginBottom:4}}><div style={{height:"100%",width:`${v}%`,background:c,borderRadius:2}}/></div>
            <div style={{fontSize:9,color:D.tm}}>{s}</div>
          </div>
        ))}
      </div>
    </GCard>

    {/* Weight trend */}
    <GCard D={D} style={{marginBottom:12}}>
      <SL D={D}>Weight Trend ({unit})</SL>
      <FilterBar D={D} value={cf} onChange={setCf}/>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={chartData} margin={{top:5,right:5,bottom:0,left:-26}}>
          <defs><linearGradient id="wG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={D.acc} stopOpacity={0.35}/><stop offset="100%" stopColor={D.acc} stopOpacity={0}/></linearGradient></defs>
          <XAxis dataKey="date" tick={{fontSize:9,fill:D.tm}}/><YAxis domain={["auto","auto"]} tick={{fontSize:9,fill:D.tm}}/>
          <Tooltip content={<TT2/>}/><Area type="monotone" dataKey="w" stroke={D.acc} fill="url(#wG)" strokeWidth={2.5} dot={{r:3,fill:D.acc,strokeWidth:0}} name={`Weight (${unit})`}/>
        </AreaChart>
      </ResponsiveContainer>
    </GCard>

    {/* Steps */}
    <GCard D={D} style={{marginBottom:12}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><SL D={D} color={D.pur}>Daily Steps</SL><div style={{fontSize:10,color:D.g}}>— {stepsGoal.toLocaleString()} goal</div></div>
      <FilterBar D={D} value={cf} onChange={setCf}/>
      <ResponsiveContainer width="100%" height={110}>
        <BarChart data={fd} margin={{top:2,right:2,bottom:0,left:-30}}>
          <defs><linearGradient id="stG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={D.pur} stopOpacity={0.9}/><stop offset="100%" stopColor={D.pur} stopOpacity={0.4}/></linearGradient></defs>
          <XAxis dataKey="date" tick={{fontSize:9,fill:D.tm}}/><YAxis tick={{fontSize:9,fill:D.tm}}/>
          <Tooltip content={<TT2/>}/><ReferenceLine y={stepsGoal} stroke={D.g} strokeDasharray="5 5" strokeWidth={1.5}/>
          <Bar dataKey="steps" radius={[4,4,0,0]} name="Steps">{fd.map((d,i)=><Cell key={i} fill={d.steps>=stepsGoal?D.g:D.pur} opacity={0.85}/>)}</Bar>
        </BarChart>
      </ResponsiveContainer>
    </GCard>

    {/* Lifestyle */}
    <GCard D={D}>
      <SL D={D}>Lifestyle Scores</SL>
      <FilterBar D={D} value={cf} onChange={setCf}/>
      <div style={{display:"flex",gap:14,marginBottom:8,flexWrap:"wrap"}}>{[["Energy",D.am],["Sleep",D.pur],["Stress*",D.r]].map(([l,c])=><div key={l} style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:D.ts}}><div style={{width:10,height:10,background:c,borderRadius:"50%"}}/>{l}</div>)}</div>
      <div style={{fontSize:9,color:D.tm,marginBottom:10}}>*Stress: lower score = better</div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={fd} margin={{top:2,right:2,bottom:0,left:-28}}>
          <XAxis dataKey="date" tick={{fontSize:9,fill:D.tm}}/><YAxis domain={[0,10]} tick={{fontSize:9,fill:D.tm}}/><Tooltip content={<TT2/>}/>
          <Line type="monotone" dataKey="e" stroke={D.am} strokeWidth={2} dot={false} name="Energy"/>
          <Line type="monotone" dataKey="sl" stroke={D.pur} strokeWidth={2} dot={false} name="Sleep"/>
          <Line type="monotone" dataKey="st" stroke={D.r} strokeWidth={2} dot={false} name="Stress"/>
        </LineChart>
      </ResponsiveContainer>
    </GCard>
  </div>;
}

/* ═══ COACH DASHBOARD V6 — Command Centre + Client Deep Dive ═ */
function CoachDashboard({D, theme, toggleTheme, onBack, plans, setPlans}) {
  const [sel, setSel] = useState(null);
  const [clients, setClients] = useState([]);
  const [rosterError, setRosterError] = useState(null);
  const [tlFilter, setTlFilter] = useState("all");

  useEffect(() => {
    async function loadRoster() {
      try {
        const res = await fetchCoachRoster();
        setClients(res.clients || []);
        setRosterError(null);
      } catch (err) {
        setRosterError(err.message || "Could not load roster");
        setClients([]);
      }
    }
    loadRoster();
  }, []);

  // Command Centre stats
  const active=clients.filter(c=>c.status==="active").length;
  const checkedIn=clients.filter(c=>c.checkedIn&&c.status==="active").length;
  const needsAttn=clients.filter(c=>clientAlerts(c).length>0).length;
  const avgAdh=Math.round(clients.filter(c=>c.status==="active").reduce((s,c)=>s+getAdherencePct(c.adherence),0)/Math.max(1,active));
  const tlCounts={g:clients.filter(c=>trafficLight(c)==="g").length,am:clients.filter(c=>trafficLight(c)==="am").length,r:clients.filter(c=>trafficLight(c)==="r").length};

  // Priority sort: critical first
  const sorted=[...clients].filter(c=>tlFilter==="all"||trafficLight(c)===tlFilter).sort((a,b)=>{
    const aAlerts=clientAlerts(a).length, bAlerts=clientAlerts(b).length;
    if(aAlerts!==bAlerts) return bAlerts-aAlerts;
    return getAdherencePct(b.adherence)-getAdherencePct(a.adherence);
  });

  // Alert color helpers
  const alertColor=(lvl)=>({r:D.r,am:D.am,g:D.g}[lvl]||D.ts);

  /* ── Individual Client Deep Dive ── */
  if (sel!==null) return <ClientDeepDive D={D} theme={theme} toggleTheme={toggleTheme} sel={sel} setSel={setSel} clients={clients} setClients={setClients} plans={plans} setPlans={setPlans}/>;

  /* ── Command Centre ── */
  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:D.bg,fontFamily:"-apple-system,system-ui,sans-serif"}}>
      <div style={{padding:"14px 18px",background:D.c1,borderBottom:`1px solid ${D.brd}`,flexShrink:0,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><LFLogo D={D} compact/><div style={{fontSize:9,color:D.acc,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginTop:4}}>Command Centre</div></div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <button onClick={toggleTheme} title="Toggle Light/Dark Theme" style={{width:32,height:32,borderRadius:"50%",background:D.c2,border:`1px solid ${D.brd}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:D.t}}>
            {theme==="dark" ? <Ic.Sun c={D.t} sz={14}/> : <Ic.Moon c={D.t} sz={14}/>}
          </button>
          <button onClick={onBack} style={{fontSize:11,color:D.ts,background:"none",border:"none",cursor:"pointer"}}>← Client View</button>
          <button onClick={async ()=>{ await logoutUser(); window.location.reload(); }} style={{fontSize:11,color:D.r,background:`${D.r}15`,border:`1px solid ${D.r}35`,borderRadius:6,padding:"4px 8px",cursor:"pointer",fontWeight:600}}>Sign Out</button>
        </div>
      </div>
      <CommandCentreBody D={D} clients={clients} sorted={sorted} setSel={setSel} active={active} checkedIn={checkedIn} needsAttn={needsAttn} tlCounts={tlCounts} tlFilter={tlFilter} setTlFilter={setTlFilter} alertColor={alertColor} rosterError={rosterError}/>
    </div>
  );
}

/* ═══ CLIENT DEEP DIVE (extracted — hooks must not live in a conditional) ═══ */
function ClientDeepDive({D, theme, toggleTheme, sel, setSel, clients, setClients, plans, setPlans}) {
    const c = (clients && sel !== null && sel !== undefined) ? clients[sel] : null;
    const [showPause,setShowPause]=useState(false);
    const [pauseReason,setPauseReason]=useState(c?.pauseReason||"");
    const [resumeDate,setResumeDate]=useState(c?.resumeDate||"");
    const [coachNote,setCoachNote]=useState(c?.note||"");
    const [localStatus,setLocalStatus]=useState(c?.status || "active");
    const [nutriDraft,setNutriDraft]=useState(plans?.nutrition||"");
    const [workDraft,setWorkDraft]=useState(plans?.workout||"");
    const [pushed,setPushed]=useState("");

    const [checkins, setCheckins] = useState([]);
    const [loadingCheckins, setLoadingCheckins] = useState(true);
    const [deepDiveError, setDeepDiveError] = useState("");
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleteReason, setDeleteReason] = useState("");
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState("");
    const [actionMsg, setActionMsg] = useState("");

    const clientId = c ? (c.id ? String(c.id).toLowerCase() : (c.name ? c.name.toLowerCase().replace(" ", "_") : "")) : "";
    const alerts = clientAlerts(c);
    const alertColor = (lvl) => ({r:D.r,am:D.am,g:D.g}[lvl]||D.ts);
    const clientAdh = calcAdh(checkins, c?.coachStepsGoal || 8000);
    const tl = trafficLight(c);
    const initials = c?.initials || (c?.name ? c.name.split(" ").map(p=>p[0]).join("").toUpperCase().slice(0, 2) : "LF");

    useEffect(() => {
      let isMounted = true;
      if (!clientId) {
        setLoadingCheckins(false);
        return;
      }
      async function loadDeepDive() {
        setLoadingCheckins(true);
        setDeepDiveError("");
        try {
          const res = await fetchCoachClientDeepDive(clientId);
          if (isMounted && res) {
            if (res.checkins) {
              setCheckins([...res.checkins].reverse());
            }
            if (res.client?.coachNote !== undefined) {
              setCoachNote(res.client.coachNote);
            }
          }
        } catch (err) {
          console.warn("Could not fetch deep dive data:", err.message);
          if (isMounted) {
            setCheckins([]);
            setDeepDiveError("Failed to load client check-ins. Please verify network or database connection.");
          }
        } finally {
          if (isMounted) setLoadingCheckins(false);
        }
      }
      loadDeepDive();
      return () => { isMounted = false; };
    }, [clientId]);

    const handleConfirmDelete = async () => {
      if (!deleteTarget || !deleteReason.trim()) return;
      setIsDeleting(true);
      setDeleteError("");
      try {
        const res = await deleteCoachClientCheckin(clientId, deleteTarget.id, deleteReason.trim());
        setCheckins(prev => prev.filter(chk => chk.id !== deleteTarget.id));
        setClients(cs => cs.map((cl, i) => i === sel ? {
          ...cl,
          latestW: res.latestW ?? cl.latestW,
          adherence: res.adherence ?? cl.adherence,
          streak: res.streak ?? cl.streak,
          trafficLight: res.trafficLight ?? cl.trafficLight,
          daysSince: res.daysSince ?? cl.daysSince,
        } : cl));
        setActionMsg(`Check-in for ${deleteTarget.fullDate || deleteTarget.date} soft-deleted. Metrics recalculated.`);
        setTimeout(() => setActionMsg(""), 4000);
        setDeleteTarget(null);
        setDeleteReason("");
      } catch (err) {
        setDeleteError(err.message || "Failed to delete check-in");
      } finally {
        setIsDeleting(false);
      }
    };

    const applyPause=async ()=>{
      try {
        await updateCoachStatus(clientId, { status: "paused", pauseReason, resumeDate });
        if (coachNote) await updateCoachNotes(clientId, coachNote);
      } catch (e) {
        console.warn("Pause status sync:", e.message);
      }
      setClients(cs=>cs.map((cl,i)=>i===sel?{...cl,status:"paused",pauseReason,resumeDate,note:coachNote}:cl));
      setLocalStatus("paused");setShowPause(false);
    };
    const applyResume=async ()=>{
      try {
        await updateCoachStatus(clientId, { status: "active", pauseReason: "", resumeDate: "" });
      } catch (e) {
        console.warn("Resume status sync:", e.message);
      }
      setClients(cs=>cs.map((cl,i)=>i===sel?{...cl,status:"active",pauseReason:"",resumeDate:""}:cl));
      setLocalStatus("active");
    };
    const pushPlan=async (kind)=>{
      try {
        await updateCoachPlans(clientId, {
          nutriPlan: kind==="nutrition"?nutriDraft:undefined,
          workPlan: kind==="workout"?workDraft:undefined
        });
      } catch (e) {
        console.warn("Push plan sync:", e.message);
      }
      setPlans(p=>({...p,[kind]:kind==="nutrition"?nutriDraft:workDraft}));
      setPushed(kind); setTimeout(()=>setPushed(""),2500);
    };

    if (!c) {
      return (
        <div style={{minHeight:"100vh",background:D.bg,padding:20,fontFamily:"-apple-system,system-ui,sans-serif"}}>
          <button onClick={()=>setSel(null)} style={{background:"none",border:"none",color:D.acc,cursor:"pointer",display:"flex",alignItems:"center",gap:4,fontSize:13,fontWeight:600}}>
            ← Back to Command Centre
          </button>
          <div style={{marginTop:20,color:D.ts,fontSize:14}}>Client not found.</div>
        </div>
      );
    }

    return (
      <div style={{height:"100vh",display:"flex",flexDirection:"column",background:D.bg,fontFamily:"-apple-system,system-ui,sans-serif"}}>
        {/* Header */}
        <div style={{padding:"14px 18px",background:D.c1,borderBottom:`1px solid ${D.brd}`,flexShrink:0,display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>setSel(null)} style={{background:"none",border:"none",color:D.acc,cursor:"pointer",padding:0,display:"flex",alignItems:"center",gap:4,fontSize:13,fontWeight:600}}><Ic.Chevron c={D.acc} sz={14} dir="left"/> Command Centre</button>
          <div style={{width:34,height:34,borderRadius:"50%",background:D.accG,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:D.acc,flexShrink:0,border:`1.5px solid ${D.brd}`}}>{initials}</div>
          <div style={{flex:1}}><div style={{fontSize:14,fontWeight:700,color:D.t}}>{c.name}</div><div style={{fontSize:10,color:D.ts}}>{c.phase || "Phase I"} · {c.prog || "Programme"} · {c.city || ""}</div></div>
          <button onClick={toggleTheme} title="Toggle Light/Dark Theme" style={{width:30,height:30,borderRadius:"50%",background:D.c2,border:`1px solid ${D.brd}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:D.t}}>
            {theme==="dark" ? <Ic.Sun c={D.t} sz={13}/> : <Ic.Moon c={D.t} sz={13}/>}
          </button>
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,fontWeight:700,padding:"4px 10px",borderRadius:20,background:`${alertColor(tl)}18`,color:alertColor(tl),border:`1px solid ${alertColor(tl)}30`}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:alertColor(tl)}}/>{TL_LABEL[tl]}
          </div>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:16}}>
          {deepDiveError && (
            <div style={{background:`${D.r}18`,border:`1px solid ${D.r}40`,borderRadius:10,padding:"10px 14px",color:D.r,fontSize:12,fontWeight:600,marginBottom:12}}>
              ⚠️ {deepDiveError}
            </div>
          )}

          {/* Alerts */}
          {alerts.length>0 && <div style={{marginBottom:12}}>
            {alerts.map((a,i)=><div key={i} style={{display:"flex",gap:8,alignItems:"center",background:`${alertColor(a.lvl)}15`,borderRadius:8,padding:"8px 12px",marginBottom:6,border:`1px solid ${alertColor(a.lvl)}30`}}>
              <Ic.Alert c={alertColor(a.lvl)} sz={14}/><span style={{fontSize:12,color:alertColor(a.lvl),fontWeight:600}}>{a.msg}</span>
            </div>)}
          </div>}

          {/* Overview stats */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            {[{v:`${c.startW ?? "—"} kg`,l:"Start Weight",c:D.ts},{v:`${c.latestW ?? "—"} kg`,l:"Latest Weight",c:D.g},{v:(c.startW != null && c.latestW != null) ? `↓ ${+(c.startW-c.latestW).toFixed(1)} kg` : "—",l:"Lost So Far",c:D.g},{v:`${getAdherencePct(c.adherence)}%`,l:"Adherence",c:getAdherencePct(c.adherence)>=80?D.g:getAdherencePct(c.adherence)>=60?D.am:D.r},{v:`${c.streak ?? 0}d`,l:"Streak",c:D.am},{v:c.checkedIn?"Today ✓":"Not Yet",l:"Check-In",c:c.checkedIn?D.g:D.r}].map((s,i)=>(
              <GCard key={i} D={D} style={{textAlign:"center",padding:"12px 8px"}}>
                <div style={{fontSize:18,fontWeight:900,color:s.c}}>{s.v}</div>
                <div style={{fontSize:9,color:D.ts,fontWeight:600,letterSpacing:0.8,textTransform:"uppercase",marginTop:3}}>{s.l}</div>
              </GCard>
            ))}
          </div>

          {/* Latest check-in data */}
          <GCard D={D} style={{marginBottom:12}}>
            <SL D={D}>Latest Check-In Snapshot</SL>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
              {[{l:"Meals",v:c.latestMeals!=null?`${c.latestMeals}/5`:"—",c:c.latestMeals>=4?D.g:c.latestMeals>=3?D.am:D.r},{l:"Steps",v:c.latestSteps!=null?Number(c.latestSteps).toLocaleString():"0",c:(c.latestSteps||0)>=(c.coachStepsGoal||8000)?D.g:(c.latestSteps||0)>=(c.coachStepsGoal||8000)*0.7?D.am:D.r},{l:"Water",v:c.latestWater!=null?`${c.latestWater}L`:"—",c:c.latestWater>=3?D.g:c.latestWater>=2?D.am:D.r},{l:"Energy",v:c.latestEnergy!=null?`${c.latestEnergy}/10`:"—",c:c.latestEnergy>=7?D.g:c.latestEnergy>=5?D.am:D.r},{l:"Stress",v:c.latestStress!=null?`${c.latestStress}/10`:"—",c:c.latestStress<=3?D.g:c.latestStress<=6?D.am:D.r},{l:"Streak",v:`${c.streak||0}d`,c:(c.streak||0)>=7?D.g:(c.streak||0)>=3?D.am:D.r}].map((s,i)=>(
                <div key={i} style={{background:D.c2,borderRadius:8,padding:"8px 10px",textAlign:"center",border:`1px solid ${D.brd}`}}>
                  <div style={{fontSize:14,fontWeight:700,color:s.c}}>{s.v}</div>
                  <div style={{fontSize:9,color:D.ts,marginTop:2}}>{s.l}</div>
                </div>
              ))}
            </div>
          </GCard>

          {/* Adherence breakdown */}
          <GCard D={D} style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><SL D={D}>7-Day Adherence Breakdown</SL><div style={{fontSize:20,fontWeight:900,color:clientAdh.overall>=80?D.g:clientAdh.overall>=60?D.am:D.r}}>{clientAdh.overall}%</div></div>
            <div style={{fontSize:9,color:D.tm,marginBottom:12}}>Meals 40% · Steps 30% · Hydration 20% · Vitamins 10%</div>
            {[{l:"Meals",v:clientAdh.meals,c:D.g},{l:"Steps",v:clientAdh.steps,c:D.pur},{l:"Hydration",v:clientAdh.water,c:"#0284c7"},{l:"Vitamins",v:clientAdh.vitamins,c:D.acc}].map(({l,v,c})=>(
              <div key={l} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:12,color:D.ts}}>{l}</span><span style={{fontSize:12,fontWeight:700,color:c}}>{v}%</span></div>
                <div style={{height:5,background:D.brd,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${v}%`,background:c,borderRadius:3}}/></div>
              </div>
            ))}
          </GCard>

          {/* Mini weight chart */}
          <GCard D={D} style={{marginBottom:12}}>
            <SL D={D}>Weight Trend (Last 7 Days)</SL>
            <ResponsiveContainer width="100%" height={110}>
              <AreaChart data={checkins.slice(0, 7).reverse()} margin={{top:5,right:5,bottom:0,left:-26}}>
                <defs><linearGradient id="cwG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={D.g} stopOpacity={0.3}/><stop offset="100%" stopColor={D.g} stopOpacity={0}/></linearGradient></defs>
                <XAxis dataKey="date" tick={{fontSize:9,fill:D.tm}}/><YAxis domain={["auto","auto"]} tick={{fontSize:9,fill:D.tm}}/>
                <Tooltip content={TT({D})}/><Area type="monotone" dataKey="w" stroke={D.g} fill="url(#cwG)" strokeWidth={2} dot={{r:2.5,fill:D.g,strokeWidth:0}} name="Weight (kg)"/>
              </AreaChart>
            </ResponsiveContainer>
          </GCard>

          {/* Check-In History & Log Management with Soft Deletion */}
          <GCard D={D} style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <SL D={D}>Check-In History & Log Management</SL>
              <div style={{fontSize:11,color:D.ts,fontWeight:600}}>{checkins.length} active entries</div>
            </div>
            {actionMsg && (
              <div style={{background:`${D.g}18`,color:D.g,border:`1px solid ${D.g}30`,borderRadius:8,padding:"8px 12px",fontSize:12,fontWeight:600,marginBottom:10}}>
                ✓ {actionMsg}
              </div>
            )}
            {loadingCheckins ? (
              <div style={{padding:"14px 0",textAlign:"center",color:D.tm,fontSize:12}}>Loading check-ins...</div>
            ) : checkins.length === 0 ? (
              <div style={{padding:"14px 0",textAlign:"center",color:D.tm,fontSize:12}}>No active check-ins found.</div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:300,overflowY:"auto",paddingRight:4}}>
                {checkins.map((chk) => (
                  <div key={chk.id || chk.fullDate || chk.date} style={{background:D.c2,borderRadius:10,padding:"10px 12px",border:`1px solid ${D.brd}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                        <span style={{fontSize:13,fontWeight:700,color:D.t}}>{formatDisplayDate(chk.fullDate || chk.date)}</span>
                        <span style={{fontSize:11,fontWeight:700,color:D.g,background:D.gG,padding:"2px 6px",borderRadius:4}}>{chk.w} kg</span>
                        <span style={{fontSize:11,color:D.ts}}>{chk.steps?.toLocaleString?.() || chk.steps} steps</span>
                      </div>
                      <div style={{fontSize:11,color:D.ts,display:"flex",gap:10}}>
                        <span>Meals: <strong style={{color:chk.meals>=4?D.g:D.am}}>{chk.meals}/5</strong></span>
                        <span>Water: <strong style={{color:chk.water>=2.5?D.g:D.am}}>{chk.water}L</strong></span>
                        <span>Energy: <strong style={{color:D.t}}>{chk.e}/10</strong></span>
                      </div>
                      {chk.note && (
                        <div style={{fontSize:10,color:D.tm,fontStyle:"italic",marginTop:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                          "{chk.note}"
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => { setDeleteTarget(chk); setDeleteReason(""); setDeleteError(""); }}
                      title="Soft delete check-in with reason"
                      style={{background:`${D.r}15`,border:`1px solid ${D.r}40`,color:D.r,borderRadius:8,padding:"6px 12px",fontSize:11,fontWeight:700,cursor:"pointer",flexShrink:0,transition:"all 0.15s ease"}}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </GCard>

          {/* Programme Management */}
          <GCard D={D} style={{marginBottom:12}}>
            <SL D={D}>Programme Management</SL>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,paddingBottom:12,borderBottom:`1px solid ${D.brd}`}}>
              <div>
                <div style={{fontSize:11,color:D.ts,marginBottom:3}}>Programme Status</div>
                <div style={{fontSize:16,fontWeight:700,color:localStatus==="active"?D.g:D.am}}>{localStatus==="active"?"Active":"Paused"}</div>
              </div>
              {localStatus==="active"
                ? <button onClick={()=>setShowPause(p=>!p)} style={{display:"flex",alignItems:"center",gap:6,padding:"9px 16px",background:D.amG,border:`1.5px solid ${D.am}50`,borderRadius:10,color:D.am,fontWeight:700,fontSize:12,cursor:"pointer"}}><Ic.Pause c={D.am} sz={14}/>Pause Programme</button>
                : <button onClick={applyResume} style={{display:"flex",alignItems:"center",gap:6,padding:"9px 16px",background:D.gG,border:`1.5px solid ${D.g}50`,borderRadius:10,color:D.g,fontWeight:700,fontSize:12,cursor:"pointer"}}><Ic.Play c={D.g} sz={14}/>Resume</button>
              }
            </div>
            {[["Phase",c.phase],["Start Date",c.startDate],["Phase Ends",c.endDate],["Current Week",`Week ${c.week} of ${c.phaseWeeks ?? 12}`]].map(([l,v])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${D.brd}`}}><span style={{fontSize:12,color:D.ts}}>{l}</span><span style={{fontSize:12,fontWeight:700,color:D.t}}>{v}</span></div>
            ))}
            {(localStatus==="paused"&&c.pauseReason)&&(
              <div style={{marginTop:12,background:D.amG,borderRadius:10,padding:12,border:`1px solid ${D.am}30`}}>
                <div style={{fontSize:10,color:D.am,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>Paused</div>
                <div style={{fontSize:12,color:D.ts}}>Reason: {c.pauseReason}</div>
                {c.resumeDate&&<div style={{fontSize:12,color:D.ts,marginTop:2}}>Expected return: {c.resumeDate}</div>}
              </div>
            )}
            {showPause&&(
              <div style={{marginTop:14,padding:14,background:D.c2,borderRadius:12,border:`1px solid ${D.brd}`}}>
                <div style={{fontSize:11,color:D.ts,marginBottom:10}}>Pause Reason</div>
                <BtnGrp D={D} options={PAUSE_REASONS} value={pauseReason} onChange={setPauseReason}/>
                <div style={{fontSize:11,color:D.ts,marginTop:12,marginBottom:6}}>Expected Resume Date</div>
                <Ti D={D} value={resumeDate} onChange={setResumeDate} type="date"/>
                <div style={{fontSize:11,color:D.ts,marginTop:12,marginBottom:6}}>Coach Note</div>
                <Ta D={D} value={coachNote} onChange={setCoachNote} placeholder="Internal note about this pause..." rows={2}/>
                <div style={{display:"flex",gap:8,marginTop:12}}>
                  <button onClick={()=>setShowPause(false)} style={{flex:1,padding:10,borderRadius:10,border:`1px solid ${D.brd}`,background:"transparent",color:D.ts,fontWeight:600,fontSize:13,cursor:"pointer"}}>Cancel</button>
                  <button onClick={applyPause} disabled={!pauseReason} style={{flex:2,padding:10,borderRadius:10,border:"none",background:D.am,color:"white",fontWeight:700,fontSize:13,cursor:pauseReason?"pointer":"not-allowed",opacity:pauseReason?1:0.5}}>Confirm Pause</button>
                </div>
              </div>
            )}
          </GCard>

          {/* Plan builder — nutrition + workout, push to client login */}
          <GCard D={D} style={{marginBottom:12}}>
            <SL D={D} color={D.g}>Nutrition Plan</SL>
            <Ta D={D} value={nutriDraft} onChange={setNutriDraft} placeholder={"Build the meal plan here.\n\nMeal 1 (8am) — 4 egg whites + 2 whole eggs, 2 slices brown bread\nMeal 2 (11am) — Whey + banana\nMeal 3 (2pm) — 150g chicken, 1 cup rice, salad\n..."} rows={8}/>
            <button onClick={()=>pushPlan("nutrition")} disabled={!nutriDraft.trim()} style={{marginTop:10,width:"100%",padding:11,background:nutriDraft.trim()?D.g:D.brd,border:"none",borderRadius:10,color:nutriDraft.trim()?"#fff":D.tm,fontWeight:700,fontSize:13,cursor:nutriDraft.trim()?"pointer":"not-allowed"}}>
              {pushed==="nutrition"?"Pushed To Client ✓":"Push Nutrition Plan To Client"}
            </button>
          </GCard>

          <GCard D={D} style={{marginBottom:12}}>
            <SL D={D} color={D.pur}>Training Plan</SL>
            <Ta D={D} value={workDraft} onChange={setWorkDraft} placeholder={"Build the workout programme here.\n\nDay 1 — Push\nBench Press 4x8\nIncline DB Press 3x10\n...\n\nDay 2 — Pull\n..."} rows={8}/>
            <button onClick={()=>pushPlan("workout")} disabled={!workDraft.trim()} style={{marginTop:10,width:"100%",padding:11,background:workDraft.trim()?D.pur:D.brd,border:"none",borderRadius:10,color:workDraft.trim()?"#fff":D.tm,fontWeight:700,fontSize:13,cursor:workDraft.trim()?"pointer":"not-allowed"}}>
              {pushed==="workout"?"Pushed To Client ✓":"Push Training Plan To Client"}
            </button>
          </GCard>

          {/* Coach private notes */}
          <GCard D={D}>
            <SL D={D}>Coach Notes (Private)</SL>
            <Ta D={D} value={coachNote} onChange={setCoachNote} placeholder="Private notes about this client — visible only to you. E.g. stress triggers, family context, business pressures..." rows={4}/>
            <button onClick={async ()=>{
              try {
                await updateCoachNotes(clientId, coachNote);
              } catch (e) {
                console.warn("Coach note sync error:", e.message);
              }
              setClients(cs=>cs.map((cl,i)=>i===sel?{...cl,note:coachNote}:cl));
            }} style={{marginTop:10,width:"100%",padding:10,background:D.accG,border:`1px solid ${D.brd}`,borderRadius:10,color:D.acc,fontWeight:700,fontSize:13,cursor:"pointer"}}>Save Notes</button>
          </GCard>
        </div>

        {/* Soft-Delete Confirmation Modal (Coach-only) */}
        {deleteTarget && (
          <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.72)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{maxWidth:450,width:"100%",background:D.c1,border:`1.5px solid ${D.r}60`,borderRadius:16,padding:22,boxShadow:"0 20px 40px rgba(0,0,0,0.6)",fontFamily:"-apple-system,system-ui,sans-serif"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                <div style={{width:38,height:38,borderRadius:"50%",background:`${D.r}20`,display:"flex",alignItems:"center",justifyContent:"center",border:`1px solid ${D.r}40`,flexShrink:0}}>
                  <Ic.Alert c={D.r} sz={18}/>
                </div>
                <div>
                  <div style={{fontSize:16,fontWeight:800,color:D.t}}>Delete Client Check-In</div>
                  <div style={{fontSize:11,color:D.ts}}>Client: <strong style={{color:D.t}}>{c.name}</strong> · Date: <strong style={{color:D.r}}>{deleteTarget.fullDate || deleteTarget.date}</strong> ({deleteTarget.w} kg)</div>
                </div>
              </div>

              <div style={{background:`${D.r}12`,border:`1px solid ${D.r}30`,borderRadius:10,padding:"10px 12px",marginBottom:14,fontSize:11,lineHeight:1.5,color:D.ts}}>
                <strong style={{color:D.r}}>Soft Deletion & Recalculation Notice:</strong><br/>
                This check-in will be soft-deleted and omitted from adherence, streak, and weight calculations. Any progress photos are safely preserved in Cloud Storage. An immutable audit log entry will be saved with your reason.
              </div>

              {deleteError && (
                <div style={{background:`${D.r}20`,border:`1px solid ${D.r}`,borderRadius:8,padding:"8px 12px",color:D.r,fontSize:12,fontWeight:600,marginBottom:12}}>
                  {deleteError}
                </div>
              )}

              <div style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:700,color:D.t,marginBottom:6}}>
                  Reason for Deletion <span style={{color:D.r}}>* (Required)</span>
                </div>
                <Ta
                  D={D}
                  value={deleteReason}
                  onChange={setDeleteReason}
                  placeholder="e.g., Client accidentally entered wrong scale reading / duplicate check-in..."
                  rows={3}
                />
              </div>

              <div style={{display:"flex",gap:10}}>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => { if (!isDeleting) setDeleteTarget(null); }}
                  style={{flex:1,padding:"10px 14px",borderRadius:10,border:`1px solid ${D.brd}`,background:"transparent",color:D.ts,fontWeight:600,fontSize:13,cursor:isDeleting?"not-allowed":"pointer"}}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!deleteReason.trim() || isDeleting}
                  onClick={handleConfirmDelete}
                  style={{
                    flex:2,
                    padding:"10px 14px",
                    borderRadius:10,
                    border:"none",
                    background:deleteReason.trim()&&!isDeleting?D.r:D.brd,
                    color:"white",
                    fontWeight:700,
                    fontSize:13,
                    cursor:deleteReason.trim()&&!isDeleting?"pointer":"not-allowed",
                    opacity:deleteReason.trim()&&!isDeleting?1:0.6
                  }}
                >
                  {isDeleting ? "Deleting..." : "Confirm Soft Delete"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
}

/* ═══ COMMAND CENTRE BODY ═══════════════════════════════════════ */
function CommandCentreBody({D, clients, sorted, setSel, active, checkedIn, needsAttn, tlCounts, tlFilter, setTlFilter, alertColor, rosterError}) {
  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const todayCleanDate = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]}`;

  return (
      <div style={{flex:1,overflowY:"auto",padding:16}}>
        {rosterError && (
          <div style={{background:D.rG,border:`1.5px solid ${D.r}`,borderRadius:14,padding:"14px 16px",color:D.r,marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
            <Ic.Alert c={D.r} sz={20}/>
            <div>
              <div style={{fontWeight:700,fontSize:13}}>Unable to load roster</div>
              <div style={{fontSize:11,color:D.ts,marginTop:2}}>{rosterError}</div>
            </div>
          </div>
        )}
        {/* Live Overview Header Card (Matching media_1789805534318.png) */}
        <div style={{background:D.c1,border:`1px solid ${D.brd}`,borderRadius:18,padding:"16px 18px",marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:700,color:D.g,display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
            <span style={{width:6,height:6,borderRadius:"50%",background:D.g,display:"inline-block"}}/>
            Live overview
          </div>
          <div style={{fontSize:22,fontWeight:900,color:D.t,letterSpacing:"-0.5px"}}>{todayCleanDate}</div>
          <div style={{fontSize:12,color:D.ts,marginTop:3}}>{active} active clients · {checkedIn} check-ins today · {clients.filter(c=>c.status==="paused").length} paused</div>
        </div>

        {/* 4 Overview cards (Matching media_1789805534318.png) */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
          <div style={{background:D.c1,border:`1px solid ${D.brd}`,borderRadius:16,padding:16}}>
            <div style={{fontSize:28,fontWeight:900,color:D.t}}>{active}</div>
            <div style={{fontSize:11,color:D.ts,fontWeight:600,marginTop:2}}>Active clients</div>
          </div>
          <div style={{background:D.c1,border:`1px solid ${D.brd}`,borderRadius:16,padding:16}}>
            <div style={{fontSize:28,fontWeight:900,color:D.g}}>{checkedIn}/{active}</div>
            <div style={{fontSize:11,color:D.ts,fontWeight:600,marginTop:2}}>Checked in today</div>
          </div>
          <div style={{background:D.c1,border:`1px solid ${D.brd}`,borderLeft:`3.5px solid ${D.am}`,borderRadius:16,padding:16}}>
            <div style={{fontSize:28,fontWeight:900,color:D.am}}>{clients.filter(c=>c.status==="paused").length}</div>
            <div style={{fontSize:11,color:D.ts,fontWeight:600,marginTop:2}}>Paused</div>
          </div>
          <div style={{background:D.c1,border:`1px solid ${D.brd}`,borderLeft:`3.5px solid ${D.r}`,borderRadius:16,padding:16}}>
            <div style={{fontSize:28,fontWeight:900,color:D.r}}>{needsAttn}</div>
            <div style={{fontSize:11,color:D.ts,fontWeight:600,marginTop:2}}>Needs attention</div>
          </div>
        </div>

        {/* Traffic light filter — draft classification, to refine together */}
        <div style={{display:"flex",gap:6,marginBottom:16}}>
          {[["all","All",D.ts,clients.length],["g","Green",D.g,tlCounts.g],["am","Yellow",D.am,tlCounts.am],["r","Red",D.r,tlCounts.r]].map(([key,l,c,n])=>(
            <button key={key} onClick={()=>setTlFilter(key)} style={{flex:1,padding:"8px 4px",borderRadius:10,border:`1.5px solid ${tlFilter===key?c:D.brd}`,background:tlFilter===key?`${c}18`:"transparent",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
              {key!=="all" && <div style={{width:8,height:8,borderRadius:"50%",background:c}}/>}
              <span style={{fontSize:10,fontWeight:700,color:tlFilter===key?c:D.ts}}>{l} {n}</span>
            </button>
          ))}
        </div>

        {/* Alert queue — clients needing attention */}
        {sorted.filter(c=>clientAlerts(c).length>0).length>0 && (
          <>
            <div style={{fontSize:9.5,color:D.r,fontWeight:700,letterSpacing:1.8,textTransform:"uppercase",marginBottom:10}}>⚠ Needs Attention</div>
            {sorted.filter(c=>clientAlerts(c).length>0).map((c,i)=>{
              const alerts=clientAlerts(c);
              return (
                <GCard key={c.id} D={D} style={{marginBottom:8,padding:14,cursor:"pointer",border:`1px solid ${D.r}25`}} onClick={()=>setSel(clients.indexOf(c))}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div style={{display:"flex",gap:10,alignItems:"center"}}><div style={{width:34,height:34,borderRadius:"50%",background:D.rG,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:D.r,border:`1.5px solid ${D.r}30`}}>{c.initials}</div><div><div style={{fontSize:14,fontWeight:700,color:D.t}}>{c.name}</div><div style={{fontSize:10,color:D.ts}}>{c.phase} · Week {c.week}</div></div></div>
                    <Ic.Chevron c={D.tm} sz={12}/>
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                    {alerts.map((a,j)=><span key={j} style={{fontSize:10,padding:"3px 8px",borderRadius:20,background:`${alertColor(a.lvl)}15`,color:alertColor(a.lvl),border:`1px solid ${alertColor(a.lvl)}30`,fontWeight:600}}>{a.msg}</span>)}
                  </div>
                </GCard>
              );
            })}
            <div style={{height:8}}/>
          </>
        )}

        {/* All clients list */}
        <div style={{fontSize:9.5,color:D.ts,fontWeight:700,letterSpacing:1.8,textTransform:"uppercase",marginBottom:10}}>All Clients</div>
        {sorted.map((c,i)=>{
          const adh = getAdherencePct(c.adherence);
          const diffW = (c.startW != null && c.latestW != null) ? +(c.startW - c.latestW).toFixed(1) : null;
          const initials = c.initials || (c.name ? c.name.split(" ").map(p=>p[0]).join("").toUpperCase().slice(0, 2) : "LF");
          const stepsDisp = c.latestSteps != null ? Number(c.latestSteps).toLocaleString() : "0";
          return (
          <GCard key={c.id || i} D={D} style={{marginBottom:10,padding:14,cursor:"pointer"}} onClick={()=>setSel(clients.indexOf(c))}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <div style={{width:36,height:36,borderRadius:"50%",background:c.checkedIn&&c.status==="active"?D.gG:c.status==="paused"?D.amG:D.rG,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:c.checkedIn&&c.status==="active"?D.g:c.status==="paused"?D.am:D.r,border:`1.5px solid ${(c.checkedIn&&c.status==="active"?D.g:c.status==="paused"?D.am:D.r)}30`}}>{initials}</div>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:8,height:8,borderRadius:"50%",background:alertColor(trafficLight(c)),flexShrink:0}} title={TL_LABEL[trafficLight(c)]+" zone"}/>
                    <div style={{fontSize:14,fontWeight:700,color:D.t}}>{c.name || "Client"}</div>
                    {c.status==="paused"&&<span style={{fontSize:8,padding:"2px 6px",borderRadius:20,background:D.amG,color:D.am,fontWeight:700}}>PAUSED</span>}
                  </div>
                  <div style={{fontSize:10,color:D.ts,marginTop:1}}>{c.phase || "Phase I"} · Wk {c.week || 1} · {c.city || ""}</div>
                </div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:13,fontWeight:700,color:D.g}}>{diffW != null ? `↓${diffW} kg` : "—"}</div>
                <div style={{fontSize:10,color:D.ts,marginTop:1}}>{c.streak ?? 0}d streak</div>
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:10,color:D.ts}}>7-Day Adherence</span><span style={{fontSize:10,fontWeight:700,color:adh>=80?D.g:adh>=60?D.am:D.r}}>{adh}%</span></div>
            <div style={{height:4,background:D.brd,borderRadius:2,overflow:"hidden",marginBottom:6}}><div style={{height:"100%",width:`${adh}%`,background:adh>=80?D.g:adh>=60?D.am:D.r,borderRadius:2}}/></div>
            <div style={{display:"flex",gap:8}}>
              {[{l:`M ${c.latestMeals ?? "—"}/5`,c:(c.latestMeals>=4)?D.g:(c.latestMeals>=3)?D.am:D.r},{l:`S ${stepsDisp}`,c:(c.latestSteps>=(c.coachStepsGoal||8000))?D.g:D.am},{l:`W ${c.latestWater ?? "—"}L`,c:(c.latestWater>=2.5)?D.g:D.am},{l:`Str ${c.latestStress ?? "—"}/10`,c:(c.latestStress<=3)?D.g:(c.latestStress<=6)?D.am:D.r}].map((s,j)=>(
                <div key={j} style={{fontSize:9,color:s.c,fontWeight:600,padding:"2px 6px",background:`${s.c}12`,borderRadius:10}}>{s.l}</div>
              ))}
            </div>
          </GCard>
        );})}
      </div>
  );
}

/* ═══ BODY, WINS, ME — (imported from V5, abbreviated for length) */
function BodyScreen({D, measurements = [], clientProfile}) {
  const [bodyTab,setBodyTab]=useState("inches");
  const [sliderPos,setSliderPos]=useState(50);
  const containerRef=useRef(null);
  const [bfH,setBfH]=useState(clientProfile?.height || 175),[bfNeck,setBfNeck]=useState(37),[bfWaist,setBfWaist]=useState(88);
  const bf=useMemo(()=>calcBF(bfWaist,bfNeck,bfH),[bfH,bfNeck,bfWaist]);
  const bfCat=!bf?["—",D.tm]:+bf<6?["Essential",D.acc]:+bf<14?["Athletic",D.g]:+bf<18?["Fit",D.pur]:+bf<25?["Average",D.am]:["High",D.r];
  const handleDrag=useCallback((e)=>{if(!containerRef.current)return;const rect=containerRef.current.getBoundingClientRect();const cX=e.touches?e.touches[0].clientX:e.clientX;setSliderPos(Math.min(100,Math.max(0,((cX-rect.left)/rect.width)*100)));},[]);
  const mParts=[["Arms","arms",D.acc],["Waist","waist",D.g],["Quads","quads",D.am],["Chest","chest",D.pur],["Shoulders","shoulders",D.r],["Hips","hips","#0284c7"],["Neck","neck","#f97316"]];
  const inchData=(measurements||[]).map(m=>({date:m.date,...mParts.reduce((o,[l,k])=>({...o,[l]:m[k]??null}),{})}));
  const dateLabels=(measurements||[]).map((m,i)=>`${m.date} (Wk ${i+1})`);
  const TT2=TT({D});
  return <div style={{padding:"16px 14px 24px"}}>
    <div style={{marginBottom:14}}><div style={{fontSize:9.5,color:D.acc,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>Measurements</div><div style={{fontSize:21,fontWeight:900,color:D.t}}>Body Metrics</div></div>
    <div style={{display:"flex",background:D.c2,borderRadius:12,padding:3,marginBottom:16,border:`1px solid ${D.brd}`}}>{[["inches","Inch Loss"],["bf","Body Fat"],["photos","Photos"]].map(([id,l])=><button key={id} onClick={()=>setBodyTab(id)} style={{flex:1,padding:"9px 0",borderRadius:9,border:"none",cursor:"pointer",background:bodyTab===id?D.accG:"transparent",color:bodyTab===id?D.acc:D.ts,fontWeight:bodyTab===id?700:400,fontSize:11,borderBottom:bodyTab===id?`2px solid ${D.acc}`:"2px solid transparent"}}>{l}</button>)}</div>
    {bodyTab==="inches"&&<>
      {measurements.length===0 ? (
        <GCard D={D} style={{textAlign:"center",padding:28}}>
          <div style={{fontSize:28,marginBottom:8}}>📏</div>
          <div style={{fontSize:14,fontWeight:700,color:D.t,marginBottom:4}}>No measurements logged yet</div>
          <div style={{fontSize:12,color:D.ts,lineHeight:1.6}}>Weekly body measurements will appear here after your first weekly check-in!</div>
        </GCard>
      ) : (
        <>
          <GCard D={D} style={{marginBottom:12}}><SL D={D}>Inch Loss Trend</SL>
            <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:10}}>{mParts.map(([l,,c])=><div key={l} style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:D.ts}}><div style={{width:10,height:3,background:c,borderRadius:2}}/>{l}</div>)}</div>
            <ResponsiveContainer width="100%" height={160}><LineChart data={inchData} margin={{top:5,right:5,bottom:0,left:-20}}><XAxis dataKey="date" tick={{fontSize:9,fill:D.tm}}/><YAxis tick={{fontSize:9,fill:D.tm}}/><Tooltip content={<TT2/>}/>{mParts.map(([l,,c])=><Line key={l} type="monotone" dataKey={l} stroke={c} strokeWidth={2.5} dot={{r:4,fill:c,strokeWidth:0}} name={l} connectNulls/>)}</LineChart></ResponsiveContainer>
          </GCard>
          <GCard D={D}><SL D={D}>Measurement Comparison</SL>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}><thead><tr><th style={{textAlign:"left",color:D.ts,padding:"5px 0",fontWeight:500,minWidth:80}}>Metric</th>{measurements.map(m=><th key={m.date} style={{textAlign:"right",color:D.acc,padding:"5px 6px",fontWeight:600,fontSize:10}}>{m.date}</th>)}<th style={{textAlign:"right",color:D.g,fontWeight:700,fontSize:10}}>Lost</th></tr></thead>
            <tbody>{mParts.map(([label,key,c])=>{const d=measurements[0][key]&&measurements[measurements.length-1][key]?+(measurements[0][key]-measurements[measurements.length-1][key]).toFixed(1):null;return <tr key={key} style={{borderTop:`1px solid ${D.brd}`}}><td style={{padding:"9px 0",color:D.ts,whiteSpace:"nowrap"}}><span style={{display:"inline-block",width:7,height:7,borderRadius:"50%",background:c,marginRight:6}}/>{label}</td>{measurements.map((m,i)=><td key={i} style={{textAlign:"right",padding:"9px 6px",color:i===measurements.length-1?D.t:D.ts}}>{m[key]??'—'}</td>)}<td style={{textAlign:"right",color:d&&d>0?D.g:D.r,fontWeight:700}}>{d?d>0?`↓${d}`:`↑${Math.abs(d)}`:"—"}</td></tr>;})}</tbody></table>
          </GCard>
        </>
      )}
    </>}
    {bodyTab==="bf"&&<>
      <GCard D={D} glowColor={bf?`${bfCat[1]}25`:"none"} style={{marginBottom:12,textAlign:"center",padding:28}}>
        <div style={{fontSize:68,fontWeight:900,color:bfCat[1],lineHeight:1,letterSpacing:"-2px"}}>{bf||"—"}{bf?"%":""}</div>
        <div style={{fontSize:16,color:bfCat[1],fontWeight:700,marginTop:6}}>{bfCat[0]}</div>
        <div style={{fontSize:10,color:D.tm,marginTop:4}}>US Military Formula · Auto-Updates With Weekly Check-In</div>
        {bf&&<><div style={{marginTop:14,height:5,background:D.brd,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min(100,(+bf/40)*100)}%`,background:`linear-gradient(90deg,${D.g},${D.am},${D.r})`,borderRadius:3}}/></div><div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontSize:8,color:D.tm}}><span>Essential</span><span>Athletic</span><span>Fit</span><span>Average</span><span>High</span></div></>}
      </GCard>
      <GCard D={D}><SL D={D}>Manual Adjustment</SL>
        {[["Height (Cm)","h",setBfH,bfH,140,210],["Neck (Cm)","n",setBfNeck,bfNeck,25,55],["Waist (Cm)","w",setBfWaist,bfWaist,50,150]].map(([l,,fn,val,mn,mx])=>(
          <div key={l} style={{marginBottom:14}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:12,color:D.ts}}>{l}</span><span style={{fontSize:13,fontWeight:700,color:D.acc}}>{val} cm</span></div><input type="range" min={mn} max={mx} value={val} onChange={e=>fn(+e.target.value)} style={{width:"100%",accentColor:D.acc,cursor:"pointer"}}/></div>
        ))}
      </GCard>
    </>}
    {bodyTab==="photos"&&<>
      <GCard D={D} style={{marginBottom:12}}><SL D={D}>Before Vs After — Choose Dates</SL>
        <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:8,alignItems:"center",marginBottom:14}}>
          <div><div style={{fontSize:9,color:D.ts,fontWeight:600,textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>Before</div><select style={{width:"100%",padding:"8px",borderRadius:8,border:`1.5px solid ${D.inpBrd}`,background:D.inp,color:D.t,fontSize:12,outline:"none"}}>{dateLabels.length>0 ? dateLabels.map((l,i)=><option key={i} value={i}>{l}</option>) : <option value="">No dates yet</option>}</select></div>
          <div style={{color:D.tm,fontWeight:700,fontSize:16}}>vs</div>
          <div><div style={{fontSize:9,color:D.g,fontWeight:600,textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>After</div><select defaultValue={Math.max(0, dateLabels.length-1)} style={{width:"100%",padding:"8px",borderRadius:8,border:`1.5px solid ${D.inpBrd}`,background:D.inp,color:D.t,fontSize:12,outline:"none"}}>{dateLabels.length>0 ? dateLabels.map((l,i)=><option key={i} value={i}>{l}</option>) : <option value="">No dates yet</option>}</select></div>
        </div>
        <div ref={containerRef} onMouseMove={e=>{if(e.buttons===1)handleDrag(e)}} onMouseDown={handleDrag} onTouchStart={handleDrag} onTouchMove={handleDrag} style={{position:"relative",userSelect:"none",borderRadius:12,overflow:"hidden",height:280,cursor:"ew-resize",background:D.c2}}>
          <div style={{position:"absolute",inset:0,background:D.dark?"linear-gradient(160deg,#0a1e34,#0f2a4a)":"linear-gradient(160deg,#e0ebff,#c8d9ff)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8}}>
            <div style={{fontSize:40,opacity:0.1}}>👤</div>
            <div style={{background:D.g,borderRadius:20,padding:"4px 14px",fontSize:11,fontWeight:700,color:"white"}}>AFTER</div>
          </div>
          <div style={{position:"absolute",inset:0,clipPath:`inset(0 ${100-sliderPos}% 0 0)`,background:D.dark?"linear-gradient(160deg,#2a1408,#3a1e0a)":"linear-gradient(160deg,#fff3e8,#ffe0c0)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8}}>
            <div style={{fontSize:40,opacity:0.1}}>👤</div>
            <div style={{background:"rgba(200,200,200,0.4)",borderRadius:20,padding:"4px 14px",fontSize:11,fontWeight:700,color:D.t}}>BEFORE</div>
          </div>
          <div style={{position:"absolute",top:0,bottom:0,left:`${sliderPos}%`,transform:"translateX(-50%)",width:2.5,background:"white",zIndex:5}}/>
          <div style={{position:"absolute",top:"50%",left:`${sliderPos}%`,transform:"translate(-50%,-50%)",width:38,height:38,borderRadius:"50%",background:"white",display:"flex",alignItems:"center",justifyContent:"center",zIndex:6,boxShadow:"0 2px 14px rgba(0,0,0,0.4)",cursor:"ew-resize",fontSize:13,userSelect:"none"}}>⟺</div>
        </div>
      </GCard>
      <GCard D={D}><SL D={D}>Upload New Photos</SL>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>{["Front","Side","Back"].map(v=><div key={v} style={{background:D.c2,borderRadius:10,border:`2px dashed ${D.brd}`,aspectRatio:"3/4",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer"}}><Ic.Camera c={D.tm} sz={20}/><div style={{fontSize:10,color:D.tm}}>{v}</div></div>)}</div>
      </GCard>
    </>}
  </div>;
}

function WinsScreen({D, clientProfile, data}) {
  const [text,setText]=useState(""); 
  const [wins,setWins]=useState([]);
  const [winError,setWinError]=useState("");
  const [submittingWin,setSubmittingWin]=useState(false);
  const dayCount = (data?.length || 0) + 1;
  const curWeek = Math.max(1, Math.ceil(dayCount / 7));
  return <div style={{padding:"16px 14px 24px"}}>
    <div style={{marginBottom:16}}><div style={{fontSize:9.5,color:D.am,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>Weekly Reflection</div><div style={{fontSize:21,fontWeight:900,color:D.t}}>Your Wins</div></div>
    <GCard D={D} glowColor={D.amG} style={{marginBottom:16}}><SL D={D} color={D.am}>This Week — Week {curWeek}</SL>
      <div style={{fontSize:12,color:D.ts,marginBottom:12,lineHeight:1.7}}>What did you achieve this week? Any win counts — a workout completed, a food choice, better sleep, more energy.</div>
      <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="e.g. Hit 10k steps on Thursday. Resisted dessert. Energy consistent all week..." style={{width:"100%",background:D.inp,border:`1.5px solid ${text?D.am:D.inpBrd}`,borderRadius:12,padding:12,fontSize:13,color:D.t,outline:"none",resize:"vertical",minHeight:100,lineHeight:1.6,fontFamily:"-apple-system,system-ui,sans-serif",boxSizing:"border-box"}}/>
      {winError && (
        <div style={{background:D.rG,border:`1px solid ${D.r}40`,borderRadius:10,padding:"10px 14px",color:D.r,fontSize:12,fontWeight:600,marginTop:10}}>
          {winError}
        </div>
      )}
      <button 
        disabled={submittingWin || !text.trim()} 
        onClick={async ()=>{
          if (!text.trim()) return;
          setSubmittingWin(true);
          setWinError("");
          const todayStr=new Date().toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
          const winPayload = {week:curWeek,date:todayStr,emoji:"⭐",text:text.trim()};
          try {
            await submitWin(winPayload);
            setWins(w=>[winPayload,...w]);
            setText("");
          } catch (err) {
            setWinError(err.message || "Failed to submit win. Please try again.");
          } finally {
            setSubmittingWin(false);
          }
        }} 
        style={{marginTop:10,width:"100%",padding:12,background:submittingWin||!text.trim()?D.brd:D.amG,border:`1px solid ${D.am}50`,borderRadius:10,color:submittingWin||!text.trim()?D.tm:D.am,fontWeight:700,fontSize:13,cursor:submittingWin||!text.trim()?"not-allowed":"pointer"}}
      >
        {submittingWin ? "Submitting..." : "Submit This Week's Wins"}
      </button>
    </GCard>
    <GCard D={D} style={{marginBottom:14,padding:"12px 18px",background:D.c3,textAlign:"center"}}><div style={{fontSize:12,color:D.ts,lineHeight:1.7,fontStyle:"italic"}}>"Every win — no matter how small — is proof that your system is working. Log it. Own it. Build on it."</div><div style={{fontSize:10,color:D.am,fontWeight:700,marginTop:8,letterSpacing:1}}>— Ram Dixit</div></GCard>
    {wins.length===0 ? (
      <GCard D={D} style={{textAlign:"center",padding:28}}>
        <div style={{fontSize:28,marginBottom:8}}>🏆</div>
        <div style={{fontSize:14,fontWeight:700,color:D.t,marginBottom:4}}>No wins logged yet</div>
        <div style={{fontSize:12,color:D.ts,lineHeight:1.6}}>Log your personal milestones, non-scale victories, and achievements above to track your weekly progress!</div>
      </GCard>
    ) : (
      wins.map((w,i)=><GCard key={i} D={D} style={{marginBottom:10,padding:18}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}><div style={{display:"flex",gap:10,alignItems:"center"}}><span style={{fontSize:24}}>{w.emoji}</span><div><div style={{fontSize:14,fontWeight:700,color:D.t}}>Week {w.week}</div><div style={{fontSize:11,color:D.ts}}>{w.date}</div></div></div><div style={{background:D.amG,border:`1px solid ${D.am}44`,borderRadius:20,padding:"3px 10px",fontSize:9,color:D.am,fontWeight:700}}>WINS</div></div><div style={{fontSize:13,color:D.ts,lineHeight:1.7,borderTop:`1px solid ${D.brd}`,paddingTop:10}}>{w.text}</div></GCard>)
    )}
  </div>;
}

function MeScreen({D,theme,toggleTheme,weightUnit,setWeightUnit,data,onboardingData,setOnboardingData,plans,clientProfile}) {
  const [profilePic,setProfilePic]=useState(null); const [copied,setCopied]=useState(false); const fileRef=useRef(null);
  const [sub,setSub]=useState(null); // null | blood | photos | onboarding | history | nutrition | workout
  const handlePic=(e)=>{const f=e.target.files[0];if(f){const r=new FileReader();r.onload=ev=>setProfilePic(ev.target.result);r.readAsDataURL(f);}};
  const shareMsg=`Hey! I've been training with Ram Dixit at LeanFit for a while now and honestly it's the first programme that's actually worked for me — daily check-ins, real accountability, a coach who actually looks at your numbers. If you've been thinking about getting serious about your fitness, you should check it out: ${REFERRAL_URL}\n\nOr if you'd rather just talk it through first, you can grab a slot on Ram's calendar here: ${CALENDLY_LINK}`;
  const shareLink=()=>{if(navigator.share)navigator.share({title:"LeanFit Coaching with Ram Dixit",text:shareMsg});else{navigator.clipboard.writeText(shareMsg).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2500);});}};
  
  const clientName = (clientProfile?.name && clientProfile.name !== "Client") 
    ? clientProfile.name 
    : (auth.currentUser?.displayName || (auth.currentUser?.email ? auth.currentUser.email.split("@")[0].replace(/[0-9._]/g, '').replace(/^./, c => c.toUpperCase()) : "Client"));
  const clientProg = clientProfile?.prog || "LeanFit 6-Month Transformation";
  const phaseStr = clientProfile?.phase || "Phase I: Rebuild";
  const phaseWeeks = clientProfile?.phaseWeeks || 12;
  const startW = clientProfile?.startW || (data?.[0]?.weight || 70.0);
  const dayCount = (data?.length || 0) + 1;
  const curWeek = Math.max(1, Math.ceil(dayCount / 7));

  const parseProfileDate = (dateStr) => {
    if (!dateStr) return new Date();
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(dateStr)) {
      const [d, m, y] = dateStr.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
      const [d, m, y] = dateStr.split("/").map(Number);
      return new Date(y, m - 1, d);
    }
    const p = new Date(dateStr);
    return isNaN(p.getTime()) ? new Date() : p;
  };

  const start = parseProfileDate(clientProfile?.startDate);
  const end = new Date(start); 
  end.setDate(end.getDate() + phaseWeeks * 7); 
  const renewal = new Date(end); 
  renewal.setDate(renewal.getDate() - 7);
  const fmt = d => d.toLocaleDateString("en-IN", {day:"numeric", month:"short", year:"numeric"});

  const secs=[
    {key:"nutrition",Icon:Ic.SaladBowl,t:"Nutrition Plan",s:plans?.nutrition?"Your personalised meal plan from Ram":"Not pushed yet — coming from Ram",c:D.g,g:D.gG,locked:!plans?.nutrition},
    {key:"workout",Icon:Ic.Dumbbell,t:"Training Plan",s:plans?.workout?"Your workout programme from Ram":"Not pushed yet — coming from Ram",c:D.pur,g:D.purG,locked:!plans?.workout},
    {key:"blood",Icon:Ic.BloodReport,t:"Blood Reports",s:"Upload your reports — markers dashboard coming soon",c:D.r,g:D.rG,locked:false},
    {key:"photos",Icon:Ic.ProgressPhotos,t:"Progress Photos",s:"Your transformation gallery",c:"#0284c7",g:"rgba(2,132,199,0.12)",locked:false},
    {key:"onboarding",Icon:Ic.OnboardForm,t:"Onboarding Form",s:"View and update your health history",c:D.am,g:D.amG,locked:false},
    {key:"history",Icon:Ic.History,t:"Check-In History",s:"Every check-in since Day 1",c:D.acc,g:D.accG,locked:false},
  ];

  if (sub) return <MeSubScreen D={D} sub={sub} onBack={()=>setSub(null)} data={data} onboardingData={onboardingData} setOnboardingData={setOnboardingData} plans={plans}/>;

  return <div style={{padding:"16px 14px 24px"}}>
    <div style={{textAlign:"center",marginBottom:24}}>
      <div style={{position:"relative",display:"inline-block"}}>
        {profilePic?<img src={profilePic} style={{width:80,height:80,borderRadius:"50%",objectFit:"cover",border:`3px solid ${D.acc}`,boxShadow:`0 0 24px ${D.accG}`}} alt="profile"/>:<div style={{width:80,height:80,borderRadius:"50%",background:`linear-gradient(135deg,${D.accD},${D.acc})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,fontWeight:900,color:"white",boxShadow:`0 0 28px ${D.accG}`,margin:"0 auto"}}>{(clientName||"C")[0].toUpperCase()}</div>}
        <button onClick={()=>fileRef.current?.click()} style={{position:"absolute",bottom:0,right:0,width:26,height:26,borderRadius:"50%",background:D.acc,border:`2px solid ${D.bg}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}><Ic.Camera c="white" sz={12}/></button>
        <input ref={fileRef} type="file" accept="image/*" onChange={handlePic} style={{display:"none"}}/>
      </div>
      <div style={{fontSize:22,fontWeight:900,color:D.t,marginTop:12,letterSpacing:"-0.5px"}}>{clientName}</div>
      <div style={{fontSize:12,color:D.ts,marginTop:2}}>{clientProg}</div>
    </div>
    <GCard D={D} style={{marginBottom:12,padding:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,paddingBottom:10,borderBottom:`1px solid ${D.brd}`}}>
        <div><div style={{fontSize:13,fontWeight:600,color:D.t}}>Appearance</div><div style={{fontSize:11,color:D.ts,marginTop:1}}>{theme==="dark"?"Dark Mode":"Light Mode"}</div></div>
        <button onClick={toggleTheme} style={{display:"flex",alignItems:"center",gap:7,padding:"8px 14px",background:D.accG,border:`1.5px solid ${D.acc}`,borderRadius:20,cursor:"pointer",color:D.acc,fontWeight:600,fontSize:12}}>{theme==="dark"?<Ic.Sun c={D.acc} sz={13}/>:<Ic.Moon c={D.acc} sz={13}/>}{theme==="dark"?"Light Mode":"Dark Mode"}</button>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontSize:13,fontWeight:600,color:D.t}}>Weight Unit</div><div style={{fontSize:11,color:D.ts,marginTop:1}}>{weightUnit?`Locked to ${weightUnit}`:"Set on first check-in"}</div></div>
        {!weightUnit?<div style={{fontSize:11,color:D.tm}}>Unlock on first check-in</div>:<div style={{display:"flex",alignItems:"center",gap:5,padding:"7px 14px",background:D.gG,borderRadius:20,border:`1.5px solid ${D.g}`}}><span style={{fontSize:13,fontWeight:700,color:D.g}}>{weightUnit}</span><Ic.Lock c={D.g} sz={12}/></div>}
      </div>
    </GCard>
    <div style={{fontSize:9.5,color:D.ts,fontWeight:700,letterSpacing:1.8,textTransform:"uppercase",marginBottom:12}}>My Programme</div>
    {secs.map(({key,Icon,t,s,c,g,locked},i)=>(
      <div key={i} onClick={()=>!locked&&setSub(key)} style={{background:g,borderRadius:12,padding:"13px 16px",marginBottom:8,border:"1px solid rgba(0,0,0,0.04)",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:locked?"default":"pointer",opacity:locked?0.75:1}}>
        <div style={{display:"flex",gap:12,alignItems:"center"}}><div style={{width:42,height:42,borderRadius:11,background:D.dark?`${c}20`:`${c}15`,display:"flex",alignItems:"center",justifyContent:"center",border:`1px solid ${c}30`}}><Icon c={c} sz={22}/></div><div><div style={{fontSize:13,fontWeight:700,color:D.t}}>{t}</div><div style={{fontSize:11,color:D.ts,marginTop:2}}>{s}</div></div></div>
        {locked?<Ic.Lock c={D.tm} sz={14}/>:<Ic.Chevron c={c} sz={14}/>}
      </div>
    ))}
    <div style={{fontSize:9.5,color:D.ts,fontWeight:700,letterSpacing:1.8,textTransform:"uppercase",marginBottom:12,marginTop:20}}>Programme Details</div>
    <GCard D={D} style={{marginBottom:12}}>
      {[["Phase",phaseStr],["Start Date",fmt(start)],["Phase I Completion",fmt(end)],["Renewal Date",fmt(renewal)],["Start Weight",`${startW} ${weightUnit || 'kg'}`],["Current Week",`Week ${curWeek} of ${phaseWeeks}`]].map(([l,v])=>(
        <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:`1px solid ${D.brd}`,flexWrap:"wrap",gap:4}}><span style={{fontSize:13,color:D.ts}}>{l}</span><span style={{fontSize:12,fontWeight:700,color:l==="Renewal Date"?D.am:D.t,textAlign:"right"}}>{v}</span></div>
      ))}
    </GCard>
    <div style={{fontSize:9.5,color:D.ts,fontWeight:700,letterSpacing:1.8,textTransform:"uppercase",marginBottom:12}}>Refer A Friend</div>
    <GCard D={D} glowColor={D.gG} style={{marginBottom:12,textAlign:"center",padding:24}}>
      <div style={{width:52,height:52,borderRadius:14,background:D.gG,border:`1px solid ${D.g}30`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px"}}><Ic.Refer c={D.g} sz={26}/></div>
      <div style={{fontSize:16,fontWeight:700,color:D.t,marginBottom:6}}>Refer A Friend</div>
      <div style={{fontSize:12,color:D.ts,lineHeight:1.7,marginBottom:18}}>Know someone who needs this? Share your link — they can join, or book a free call with Ram first.</div>
      <button onClick={shareLink} style={{width:"100%",padding:13,background:D.gG,border:`1.5px solid ${D.g}`,borderRadius:12,color:D.g,fontWeight:700,fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><Ic.Share c={D.g} sz={16}/>{copied?"Message Copied ✓":"Share My Link"}</button>
    </GCard>
    <button onClick={async ()=>{ await logoutUser(); window.location.reload(); }} style={{width:"100%",padding:14,background:"transparent",border:`1px solid ${D.brd}`,borderRadius:12,fontSize:13,fontWeight:600,color:D.ts,cursor:"pointer",marginTop:6}}>Sign Out</button>
  </div>;
}

/* ═══ ME SUB-SCREENS ═══════════════════════════════════════════ */
function MeSubScreen({D,sub,onBack,data,onboardingData,setOnboardingData,plans}) {
  const titles={blood:"Blood Reports",photos:"Progress Photos",onboarding:"Onboarding Form",history:"Check-In History",nutrition:"Nutrition Plan",workout:"Training Plan"};
  return <div style={{padding:"14px 16px 24px"}}>
    <button onClick={onBack} style={{background:"none",border:"none",color:D.acc,cursor:"pointer",padding:0,display:"flex",alignItems:"center",gap:5,fontSize:13,fontWeight:700,marginBottom:16}}><Ic.Chevron c={D.acc} sz={15} dir="left"/> My Profile</button>
    <div style={{fontSize:19,fontWeight:900,color:D.t,marginBottom:16}}>{titles[sub]}</div>
    {sub==="blood" && <BloodReportsSub D={D}/>}
    {sub==="photos" && <ProgressPhotosSub D={D} data={data}/>}
    {sub==="onboarding" && <OnboardingFormSub D={D} onboardingData={onboardingData} setOnboardingData={setOnboardingData}/>}
    {sub==="history" && <CheckInHistorySub D={D} data={data}/>}
    {sub==="nutrition" && <PlanSub D={D} plan={plans?.nutrition} c={D.g} empty="No nutrition plan pushed yet."/>}
    {sub==="workout" && <PlanSub D={D} plan={plans?.workout} c={D.pur} empty="No training plan pushed yet."/>}
  </div>;
}

function PlanSub({D,plan,c,empty}) {
  if (!plan) return <GCard D={D} style={{textAlign:"center",padding:30}}><div style={{fontSize:13,color:D.ts}}>{empty}</div></GCard>;
  return <GCard D={D} style={{whiteSpace:"pre-wrap",lineHeight:1.7,fontSize:13,color:D.t}}>{plan}</GCard>;
}

function BloodReportsSub({D}) {
  const [reports,setReports]=useState([]);
  const [uploading,setUploading]=useState(false);
  const fileRef=useRef(null);
  const handleUpload=async (e)=>{
    const f=e.target.files[0]; if(!f) return;
    setUploading(true);
    try {
      const { uploadUrl, gcsPath } = await getReportUploadUrl(f.name, f.type);
      await uploadFileToSignedUrl(uploadUrl, f, f.type);
      const res = await confirmReportUpload({
        name: f.name,
        gcsPath,
        sizeBytes: f.size,
        sizeDisp: (f.size/1024/1024).toFixed(2)+" MB",
        date: new Date().toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})
      });
      setReports(r=>[res.report || {
        name: f.name,
        size: (f.size/1024/1024).toFixed(2)+" MB",
        date: new Date().toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}),
        downloadUrl: uploadUrl
      }, ...r]);
    } catch (err) {
      console.warn("Storage upload fallback:", err.message);
      setReports(r=>[{name:f.name,size:(f.size/1024/1024).toFixed(2)+" MB",date:new Date().toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})},...r]);
    } finally {
      setUploading(false);
      e.target.value="";
    }
  };
  const remove=(i)=>setReports(r=>r.filter((_,j)=>j!==i));
  return <>
    <GCard D={D} style={{marginBottom:14,textAlign:"center",padding:22}}>
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={handleUpload} style={{display:"none"}}/>
      <div style={{width:52,height:52,borderRadius:14,background:D.rG,border:`1px solid ${D.r}30`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px"}}><Ic.Upload c={D.r} sz={24}/></div>
      <div style={{fontSize:13,color:D.t,fontWeight:700,marginBottom:4}}>Upload Blood Report</div>
      <div style={{fontSize:11,color:D.ts,marginBottom:16}}>PDF only · Uploaded directly to private Cloud Storage</div>
      <button onClick={()=>fileRef.current?.click()} disabled={uploading} style={{padding:"11px 20px",background:D.r,border:"none",borderRadius:12,color:"white",fontWeight:700,fontSize:13,cursor:uploading?"not-allowed":"pointer",opacity:uploading?0.7:1}}>
        {uploading ? "Uploading to Cloud Storage..." : "Choose PDF"}
      </button>
    </GCard>
    {reports.length===0
      ? <div style={{textAlign:"center",fontSize:12,color:D.tm,padding:20}}>No reports uploaded yet.</div>
      : reports.map((r,i)=>(
        <GCard key={i} D={D} style={{marginBottom:8,padding:14,display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:38,height:38,borderRadius:10,background:D.rG,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic.FilePdf c={D.r} sz={18}/></div>
          <div style={{flex:1,minWidth:0,cursor:r.downloadUrl?"pointer":"default"}} onClick={()=>r.downloadUrl&&window.open(r.downloadUrl,"_blank")}>
            <div style={{fontSize:12,fontWeight:700,color:D.t,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</div>
            <div style={{fontSize:10,color:D.ts,marginTop:2}}>{r.date} · {r.size} {r.downloadUrl?"· Click to view":""}</div>
          </div>
          <button onClick={()=>remove(i)} style={{background:"none",border:"none",cursor:"pointer",padding:4}}><Ic.Trash c={D.tm} sz={15}/></button>
        </GCard>
      ))}
  </>;
}

function ProgressPhotosSub({D,data}) {
  const withPhotos=data.filter(d=>d.photos && (d.photos.Front||d.photos.Side||d.photos.Back));
  if (withPhotos.length===0) return <div style={{textAlign:"center",fontSize:12,color:D.tm,padding:30}}>No progress photos uploaded yet — they'll appear here after your weekly measurement day.</div>;
  return <>{withPhotos.map((d,i)=>(
    <GCard key={i} D={D} style={{marginBottom:12,padding:14}}>
      <div style={{fontSize:11,color:D.ts,fontWeight:700,marginBottom:10}}>{d.date}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
        {["Front","Side","Back"].map(v=>(
          <div key={v} style={{aspectRatio:"3/4",borderRadius:8,overflow:"hidden",background:D.c2,display:"flex",alignItems:"center",justifyContent:"center",border:`1px solid ${D.brd}`}}>
            {d.photos[v]?<img src={d.photos[v]} alt={v} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:9,color:D.tm}}>{v} —</span>}
          </div>
        ))}
      </div>
    </GCard>
  ))}</>;
}

function OnboardingFormSub({D,onboardingData,setOnboardingData}) {
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState(onboardingData||{});
  if (!onboardingData) return <div style={{textAlign:"center",fontSize:12,color:D.tm,padding:30}}>No onboarding record found for this account yet.</div>;
  const F=(k,v)=>setDraft(p=>({...p,[k]:v}));
  const save=()=>{setOnboardingData(draft);setEditing(false);};
  const groups=[
    {t:"Personal & Contact",fields:[["name","Full Name"],["age","Age"],["gender","Gender"],["phone","Phone"],["email","Email"],["city","City"],["occupation","Occupation"]]},
    {t:"Body Baseline",fields:[["height","Height"],["weight","Starting Weight"],["weightUnit","Weight Unit"],["measUnit","Measurement Unit"]]},
    {t:"Health History",fields:[["conditions","Medical Conditions"],["injuries","Injuries / Surgeries"],["medications","Medications"],["allergies","Allergies"]]},
    {t:"Lifestyle & Habits",fields:[["sleepHrs","Sleep (hrs)"],["workType","Work Schedule"],["activityLevel","Activity Level"],["smoking","Smoking"],["alcohol","Alcohol"],["stressBaseline","Stress Level"]]},
    {t:"Nutrition Preferences",fields:[["diet","Diet Type"],["mealsPerDay","Meals/Day"],["foodDislikes","Dislikes"],["cookingAccess","Cooking Access"]]},
    {t:"Training Background",fields:[["trainingExp","Experience"],["equipment","Equipment"],["workoutTime","Preferred Time"],["physicalLimits","Physical Limits"]]},
    {t:"Goals & Motivation",fields:[["goal","Primary Goal"],["targetTimeline","Target Timeline"],["motivation","Motivation"],["obstacle","Past Obstacle"]]},
  ];
  return <>
    <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
      {editing
        ? <div style={{display:"flex",gap:8}}><button onClick={()=>{setDraft(onboardingData);setEditing(false);}} style={{padding:"8px 16px",borderRadius:10,border:`1px solid ${D.brd}`,background:"transparent",color:D.ts,fontWeight:600,fontSize:12,cursor:"pointer"}}>Cancel</button><button onClick={save} style={{padding:"8px 16px",borderRadius:10,border:"none",background:D.acc,color:"white",fontWeight:700,fontSize:12,cursor:"pointer"}}>Save Changes</button></div>
        : <button onClick={()=>setEditing(true)} style={{padding:"8px 16px",borderRadius:10,border:`1px solid ${D.acc}`,background:D.accG,color:D.acc,fontWeight:700,fontSize:12,cursor:"pointer"}}>Edit</button>}
    </div>
    {groups.map(g=>(
      <GCard key={g.t} D={D} style={{marginBottom:12}}>
        <SL D={D}>{g.t}</SL>
        {g.fields.map(([k,l])=>(
          <div key={k} style={{marginBottom:editing?12:0,paddingBottom:editing?0:10,borderBottom:editing?"none":`1px solid ${D.brd}`,display:editing?"block":"flex",justifyContent:"space-between",gap:8}}>
            {editing
              ? <><div style={{fontSize:11,color:D.ts,marginBottom:5}}>{l}</div><Ti D={D} value={draft[k]||""} onChange={v=>F(k,v)}/></>
              : <><span style={{fontSize:12,color:D.ts,flexShrink:0}}>{l}</span><span style={{fontSize:12,fontWeight:600,color:D.t,textAlign:"right"}}>{onboardingData[k]||"—"}</span></>}
          </div>
        ))}
      </GCard>
    ))}
  </>;
}

function CheckInHistorySub({D,data}) {
  const cols=[["date","Date"],["w","Wt"],["steps","Steps"],["meals","Meals"],["water","Water"],["e","Energy"],["sl","Sleep"],["st","Stress"],["wrk","Wrkts"]];
  return <GCard D={D} style={{padding:0,overflow:"hidden"}}>
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
        <thead><tr style={{background:D.c2}}>{cols.map(([k,l])=><th key={k} style={{padding:"9px 10px",textAlign:"left",color:D.ts,fontWeight:700,whiteSpace:"nowrap",borderBottom:`1px solid ${D.brd}`}}>{l}</th>)}</tr></thead>
        <tbody>{[...data].reverse().map((d,i)=>(
          <tr key={i} style={{borderBottom:`1px solid ${D.brd}`}}>
            {cols.map(([k])=><td key={k} style={{padding:"9px 10px",color:D.t,whiteSpace:"nowrap"}}>{k==="water"?`${d[k]}L`:k==="meals"?`${d[k]}/5`:k==="date"?formatDisplayDate(d.fullDate||d.date):d[k]}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  </GCard>;
}

function BottomNav({D,tab,setTab}) {
  const left=[{id:"dashboard",Icon:Ic.Progress,l:"Progress"},{id:"body",Icon:Ic.Body,l:"Body"}];
  const right=[{id:"wins",Icon:Ic.Wins,l:"Wins"},{id:"me",Icon:Ic.Me,l:"Me"}];
  const NavBtn=({id,Icon,l})=>{
    const a=tab===id;
    return (
      <button key={id} onClick={()=>setTab(id)} style={{flex:1,padding:"10px 0 8px",background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
        <Icon c={a?D.acc:D.ts} sz={24}/>
        <span style={{fontSize:11,fontWeight:a?800:600,color:a?D.acc:D.ts,letterSpacing:0.3}}>{l}</span>
      </button>
    );
  };
  return <div style={{position:"relative",background:D.c1,borderTop:`1px solid ${D.brd}`,display:"flex",alignItems:"center",flexShrink:0,padding:"2px 0"}}>
    {left.map(t=>NavBtn(t))}
    <div style={{flex:1,display:"flex",justifyContent:"center",position:"relative"}}>
      <button onClick={()=>setTab("checkin")} style={{position:"absolute",top:-26,width:56,height:56,borderRadius:"50%",background:tab==="checkin"?D.acc:D.g,border:`4px solid ${D.c1}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",boxShadow:`0 6px 18px ${D.gG}`}}>
        <Ic.Plus c="#ffffff" sz={26}/>
      </button>
    </div>
    {right.map(t=>NavBtn(t))}
  </div>;
}

/* ═══ ONBOARDING SCREEN (new client intake) ═══════════════════ */
function OnboardingScreen({D,onComplete}) {
  const [step,setStep]=useState(0);
  const [form,setForm]=useState({
    name:"",age:"",gender:"",phone:"",email:"",city:"",occupation:"",
    height:"",weight:"",weightUnit:"kg",measUnit:"cm",
    conditions:"",injuries:"",medications:"",allergies:"",
    avgSteps:"",sleepHrs:"",workType:"",activityLevel:"",smoking:"",alcohol:"",stressBaseline:"",
    diet:"",proteins:[],mealsPerDay:"",foodDislikes:"",cookingAccess:"",
    trainingExp:"",equipment:"",workoutTime:"",physicalLimits:"",
    goal:"",targetTimeline:"",motivation:"",obstacle:"",why:"",
    mArms:"",mWaist:"",mQuads:"",mChest:"",mShoulders:"",mHips:"",mNeck:"",
    photoFront:null,photoSide:null,photoBack:null,
  });
  const [autosaved,setAutosaved]=useState(true);

  // Restore draft from localStorage if available
  useEffect(()=>{
    try {
      const draft = localStorage.getItem("leanfit_onboarding_draft");
      if (draft) {
        const parsed = JSON.parse(draft);
        setForm(p=>({...p,...parsed}));
      }
    } catch (_) {}
  },[]);

  const autoSaveToBackend = useCallback(async (updatedForm)=>{
    try {
      setAutosaved(false);
      localStorage.setItem("leanfit_onboarding_draft", JSON.stringify(updatedForm));
      await submitOnboarding(updatedForm);
      setAutosaved(true);
    } catch (err) {
      // Still saved to local draft even if backend network blips
      setAutosaved(true);
    }
  },[]);

  const F=(k,v)=>{
    setForm(p=>{
      const updated={...p,[k]:v};
      autoSaveToBackend(updated);
      return updated;
    });
  };
  const toggleProtein=(p)=>setForm(f=>{
    const updatedProteins = f.proteins.includes(p)?f.proteins.filter(x=>x!==p):[...f.proteins,p];
    const updated = {...f, proteins: updatedProteins};
    autoSaveToBackend(updated);
    return updated;
  });

  const steps=[
    {title:"Personal & Contact",sub:"Let's get the essentials down first."},
    {title:"Body Baseline & Units",sub:"Your starting point — this is what every future check-in gets measured against."},
    {title:"Health History",sub:"Helps Ram flag anything to be careful of before building your plan."},
    {title:"Lifestyle & Habits",sub:"Your day-to-day routine outside the gym matters just as much."},
    {title:"Nutrition Preferences",sub:"So Ram can plan meals you'll actually eat."},
    {title:"Exercise Experience",sub:"What you've done before, and what you have access to now."},
    {title:"Goals & Motivation",sub:"What are we actually working towards?"},
    {title:"Body Measurements",sub:"Your baseline — all measurements are mandatory (*)."},
    {title:"Progress Photos",sub:"Day 1 photos — empty stomach, morning, relaxed pose (optional)."},
  ];

  const canNext = [
    // Step 0: Personal & Contact
    !!form.name && !!form.age && (!form.email || form.email.includes("@")),
    // Step 1: Body Baseline & Units
    !!form.height && !!form.weight,
    // Step 2: Health History (ALL mandatory)
    !!form.conditions?.trim() && !!form.injuries?.trim() && !!form.medications?.trim() && !!form.allergies?.trim(),
    // Step 3: Lifestyle & Habits (ALL mandatory including average steps)
    !!form.avgSteps && !!form.sleepHrs && !!form.workType && !!form.activityLevel && !!form.smoking && !!form.alcohol && !!form.stressBaseline,
    // Step 4: Nutrition Preferences (ALL mandatory)
    !!form.diet && form.proteins.length > 0 && !!form.mealsPerDay && !!form.cookingAccess,
    // Step 5: Exercise Experience (ALL mandatory)
    !!form.trainingExp && !!form.equipment && !!form.workoutTime && !!form.physicalLimits?.trim(),
    // Step 6: Goals & Motivation (ALL mandatory)
    !!form.goal?.trim() && !!form.targetTimeline?.trim() && !!form.motivation?.trim() && !!form.obstacle?.trim() && !!form.why?.trim(),
    // Step 7: Body Measurements (ALL mandatory)
    !!form.mArms && !!form.mWaist && !!form.mQuads && !!form.mChest && !!form.mShoulders && !!form.mHips && !!form.mNeck,
    // Step 8: Progress Photos (Optional)
    true,
  ][step] ?? true;

  const [createdAccount, setCreatedAccount] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    setSubmitError("");
    const email = (form.email || "").trim().toLowerCase();

    try {
      const res = await registerOnboarding({
        ...form,
        email
      });
      if (res && res.password) {
        setCreatedAccount(res);
      } else if (res && res.account) {
        setCreatedAccount(res.account);
      } else {
        throw new Error("Invalid response from registration service.");
      }
    } catch (err) {
      console.warn("Backend onboarding sync error:", err.message);
      setSubmitError(err.message || "Registration failed. An account with this email may already exist.");
    } finally {
      setSubmitting(false);
    }
  };

  if (createdAccount) {
    const handleCopy = () => {
      try {
        navigator.clipboard?.writeText(createdAccount.password);
      } catch (_) {}
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    };

    return (
      <div style={{minHeight:"100vh",background:D.bg,fontFamily:"-apple-system,system-ui,sans-serif",display:"flex",flexDirection:"column"}}>
        <div style={{
          background: "linear-gradient(90deg, #071329 0%, #0c204c 30%, #153c8c 70%, #1d4fd8 100%)",
          padding: "26px 20px 22px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
          flexShrink: 0
        }}>
          <div style={{fontSize:34,fontWeight:900,fontStyle:"italic",color:"#ffffff",letterSpacing:-1,lineHeight:1}}>LF</div>
          <div style={{fontSize:14,fontWeight:900,color:"#ffffff",letterSpacing:6,marginTop:5,textIndent:6}}>LEANFIT</div>
          <div style={{fontSize:8,fontWeight:700,color:"rgba(255,255,255,0.75)",letterSpacing:2.5,marginTop:3,textIndent:2.5}}>— HEALTH & LIFESTYLE —</div>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:"24px 20px",maxWidth:440,margin:"0 auto",width:"100%"}}>
          <div style={{textAlign:"center",marginBottom:20}}>
            <div style={{display:"inline-flex",alignItems:"center",gap:6,background:D.gG,border:`1px solid ${D.g}40`,padding:"6px 14px",borderRadius:20,color:D.g,fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:1.5,marginBottom:12}}>
              🎉 Intake Complete & Account Created
            </div>
            <div style={{fontSize:26,fontWeight:900,color:D.t,letterSpacing:-0.5,marginBottom:6}}>
              Welcome, {createdAccount.name}!
            </div>
            <div style={{fontSize:12.5,color:D.ts,lineHeight:1.5}}>
              Your LeanFit portal account is live. Here are your personal login credentials:
            </div>
          </div>

          <GCard D={D} glowColor={D.accG} style={{marginBottom:16,border:`1.5px solid ${D.acc}40`}}>
            <div style={{fontSize:10,color:D.acc,fontWeight:800,letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>
              Your Portal Login Credentials
            </div>

            <div style={{background:D.c2,borderRadius:12,padding:"10px 14px",marginBottom:10,border:`1px solid ${D.brd}`}}>
              <div style={{fontSize:10,color:D.ts,fontWeight:600,textTransform:"uppercase",letterSpacing:1,marginBottom:2}}>Email / Username</div>
              <div style={{fontSize:14,color:D.t,fontWeight:800,fontFamily:"monospace",wordBreak:"break-all"}}>{createdAccount.email}</div>
            </div>

            <div style={{background:D.c2,borderRadius:12,padding:"10px 14px",marginBottom:14,border:`1px solid ${D.brd}`}}>
              <div style={{fontSize:10,color:D.ts,fontWeight:600,textTransform:"uppercase",letterSpacing:1,marginBottom:2}}>Password</div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                <div style={{fontSize:15,color:D.t,fontWeight:800,fontFamily:"monospace",letterSpacing:showPass?0.5:2}}>
                  {showPass ? createdAccount.password : "••••••••••••••"}
                </div>
                <div style={{display:"flex",gap:6,flexShrink:0}}>
                  <button 
                    type="button" 
                    onClick={()=>setShowPass(s=>!s)} 
                    style={{background:"transparent",border:`1px solid ${D.brd}`,borderRadius:8,padding:"5px 8px",color:D.ts,fontSize:11,cursor:"pointer",fontWeight:600}}
                  >
                    {showPass ? "Hide" : "Show"}
                  </button>
                  <button 
                    type="button" 
                    onClick={handleCopy} 
                    style={{background:copied?D.g:D.acc,border:"none",borderRadius:8,padding:"5px 10px",color:"#ffffff",fontSize:11,cursor:"pointer",fontWeight:700,transition:"all 0.2s"}}
                  >
                    {copied ? "✓ Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            </div>

            <div style={{display:"flex",justifyContent:"space-between",background:D.c1,borderRadius:10,padding:"8px 12px",border:`1px solid ${D.brd}`}}>
              <span style={{fontSize:11,color:D.ts}}>Starting Weight:</span>
              <span style={{fontSize:11,color:D.t,fontWeight:700}}>{createdAccount.startW} {createdAccount.weightUnit}</span>
            </div>
          </GCard>

          <div style={{background:D.c2,border:`1px solid ${D.brd}`,borderRadius:14,padding:"12px 14px",marginBottom:20,fontSize:11,color:D.ts,lineHeight:1.6}}>
            💡 <strong>Please save your password now</strong> or store it in your password manager. Coach Ram has also received your intake details and credentials.
          </div>

          <button 
            type="button" 
            onClick={()=>onComplete(form, createdAccount)}
            style={{width:"100%",padding:16,background:D.g,border:"none",borderRadius:14,fontSize:14,fontWeight:800,color:"#0d1b3e",cursor:"pointer",boxShadow:`0 0 24px ${D.gG}`}}
          >
            Enter My Portal →
          </button>
        </div>
      </div>
    );
  }

  return <div style={{minHeight:"100vh",background:D.bg,fontFamily:"-apple-system,system-ui,sans-serif",display:"flex",flexDirection:"column"}}>
    {/* TOP BRAND HEADER BANNER (Deep Navy to Royal Blue Gradient with Centered Logo Hero) */}
    <div style={{
      background: "linear-gradient(90deg, #071329 0%, #0c204c 30%, #153c8c 70%, #1d4fd8 100%)",
      padding: "26px 20px 22px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      borderBottom: "1px solid rgba(255,255,255,0.1)",
      boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
      flexShrink: 0
    }}>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center"}}>
        {/* LF Monogram */}
        <div style={{fontSize:34,fontWeight:900,fontStyle:"italic",color:"#ffffff",letterSpacing:-1,lineHeight:1}}>
          LF
        </div>
        {/* LEANFIT */}
        <div style={{fontSize:14,fontWeight:900,color:"#ffffff",letterSpacing:6,marginTop:5,textIndent:6}}>
          LEANFIT
        </div>
        {/* HEALTH & LIFESTYLE */}
        <div style={{fontSize:8,fontWeight:700,color:"rgba(255,255,255,0.75)",letterSpacing:2.5,marginTop:3,textIndent:2.5}}>
          — HEALTH & LIFESTYLE —
        </div>
      </div>
    </div>

    {/* SUB-HEADER: COACHING INTAKE & TITLE */}
    <div style={{
      background: D.dark ? D.c1 : "#f0f5fc",
      borderBottom: `1px solid ${D.dark ? D.brd : "rgba(24, 72, 160, 0.12)"}`,
      padding: "18px 20px 14px",
      flexShrink: 0
    }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
        <div>
          <div style={{fontSize:10.5,fontWeight:800,fontFamily:"monospace",color:"#2563eb",letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>
            COACHING INTAKE
          </div>
          <div style={{fontSize:24,fontWeight:900,color:D.t,letterSpacing:-0.5,lineHeight:1.15}}>
            Apply for<br/>1–1 Coaching
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:5,background:"rgba(16,185,129,0.12)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:20,padding:"4px 10px",fontSize:10,fontWeight:700,color:"#10b981"}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:"#10b981"}}/>
          {autosaved ? "Autosaved" : "Saving..."}
        </div>
      </div>

      {/* STEP PROGRESS BAR */}
      <div style={{marginTop:14,paddingTop:10,borderTop:`1px solid ${D.dark ? D.brd : "rgba(24, 72, 160, 0.08)"}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{fontSize:10,fontWeight:700,color:D.ts,textTransform:"uppercase",letterSpacing:1}}>
            Step {step+1} of {steps.length}: <span style={{color:D.t}}>{steps[step].title}</span>
          </div>
          <div style={{fontSize:10,fontWeight:800,color:"#2563eb"}}>{Math.round(((step+1)/steps.length)*100)}%</div>
        </div>
        <div style={{display:"flex",gap:4}}>
          {steps.map((_,i)=><div key={i} style={{flex:1,height:4,borderRadius:2,background:i<=step?"#2563eb":D.dark?"rgba(255,255,255,0.1)":"rgba(37,99,235,0.15)",transition:"background 0.3s ease"}}/>)}
        </div>
        <div style={{fontSize:11,color:D.ts,marginTop:6,lineHeight:1.4}}>{steps[step].sub}</div>
      </div>
    </div>

    <div style={{flex:1,overflowY:"auto",padding:"18px 20px 24px"}}>
      {step===0 && <>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Full Name *</SL>
          <Ti D={D} value={form.name} onChange={v=>F("name",v)} placeholder="e.g. Rahul Sharma"/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Age *</SL>
          <Ti D={D} type="number" value={form.age} onChange={v=>F("age",v)} placeholder="e.g. 34"/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Gender</SL>
          <BtnGrp D={D} options={["Male","Female"]} value={form.gender} onChange={v=>F("gender",v)}/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Phone Number</SL>
          <Ti D={D} type="number" value={form.phone} onChange={v=>F("phone",v)} placeholder="e.g. 9876543210" style={{letterSpacing:1}}/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Email *</SL>
          <Ti D={D} type="email" value={form.email} onChange={v=>F("email",v)} placeholder="e.g. rahul@email.com"/>
          {form.email&&!form.email.includes("@")&&<div style={{fontSize:10,color:D.r,marginTop:5}}>Please enter a valid email with @</div>}
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>City</SL>
          <Ti D={D} value={form.city} onChange={v=>F("city",v)} placeholder="e.g. Mumbai"/>
        </GCard>
        <GCard D={D}>
          <SL D={D}>Occupation</SL>
          <Ti D={D} value={form.occupation} onChange={v=>F("occupation",v)} placeholder="e.g. Investment Banker, Founder, Consultant"/>
        </GCard>
      </>}

      {step===1 && <>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Weight Unit *</SL>
          <Tog3 D={D} options={["kg","lbs"]} value={form.weightUnit} onChange={newUnit => {
            if (newUnit !== form.weightUnit) {
              setForm(p => {
                let newWeight = p.weight;
                if (p.weight) {
                  newWeight = newUnit === "lbs" 
                    ? +(parseFloat(p.weight) * 2.20462).toFixed(1)
                    : +(parseFloat(p.weight) / 2.20462).toFixed(1);
                }
                const updated = { ...p, weightUnit: newUnit, weight: newWeight || "" };
                autoSaveToBackend(updated);
                return updated;
              });
            }
          }}/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Measurement Unit *</SL>
          <Tog3 D={D} options={["cm","inches"]} value={form.measUnit} onChange={newUnit => {
            if (newUnit !== form.measUnit) {
              setForm(p => {
                let newHeight = p.height;
                if (p.height) {
                  newHeight = newUnit === "inches"
                    ? +(parseFloat(p.height) / 2.54).toFixed(1)
                    : +(parseFloat(p.height) * 2.54).toFixed(1);
                }
                const updated = { ...p, measUnit: newUnit, height: newHeight || "" };
                autoSaveToBackend(updated);
                return updated;
              });
            }
          }}/>
          <div style={{fontSize:10,color:D.tm,marginTop:8}}>⚠ This locks once you start — it's what every weekly measurement will use.</div>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Height ({form.measUnit==="inches"?"in":"cm"}) *</SL>
          <Ti D={D} type="number" value={form.height} onChange={v=>F("height",v)} placeholder={form.measUnit==="inches"?"e.g. 69":"e.g. 175"}/>
        </GCard>
        <GCard D={D}>
          <SL D={D}>Starting Weight ({form.weightUnit}) *</SL>
          <Ti D={D} type="number" value={form.weight} onChange={v=>F("weight",v)} placeholder={form.weightUnit==="lbs"?"e.g. 150":"e.g. 68"}/>
        </GCard>
      </>}

      {step===2 && <>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Existing Medical Conditions *</SL>
          <Ta D={D} value={form.conditions} onChange={v=>F("conditions",v)} placeholder="e.g. thyroid, PCOS, diabetes, high BP, or 'None'..." rows={3}/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Past Injuries Or Surgeries *</SL>
          <Ta D={D} value={form.injuries} onChange={v=>F("injuries",v)} placeholder="e.g. lower back, knee surgery in 2022, shoulder impingement, or 'None'..." rows={3}/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Current Medications *</SL>
          <Ta D={D} value={form.medications} onChange={v=>F("medications",v)} placeholder="Anything you're currently taking, or 'None' if not applicable" rows={2}/>
        </GCard>
        <GCard D={D}>
          <SL D={D}>Allergies *</SL>
          <Ta D={D} value={form.allergies} onChange={v=>F("allergies",v)} placeholder="Food, medication, or environmental allergies, or 'None' if none" rows={2}/>
        </GCard>
      </>}

      {step===3 && <>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Average Daily Steps *</SL>
          <Ti D={D} type="number" value={form.avgSteps} onChange={v=>F("avgSteps",v)} placeholder="e.g. 5000, 8000, 10000"/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Average Sleep (Hours/Night) *</SL>
          <Ti D={D} type="number" value={form.sleepHrs} onChange={v=>F("sleepHrs",v)} placeholder="e.g. 6.5"/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Work Schedule *</SL>
          <BtnGrp D={D} options={["Desk Job","On My Feet All Day","Frequent Travel","Shift-Based","Mixed"]} value={form.workType} onChange={v=>F("workType",v)}/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Daily Activity Level (Outside Workouts) *</SL>
          <BtnGrp D={D} options={["Mostly Sedentary","Lightly Active","Moderately Active","Very Active"]} value={form.activityLevel} onChange={v=>F("activityLevel",v)}/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Smoking *</SL>
          <BtnGrp D={D} options={["Never","Occasionally","Regularly","Trying To Quit"]} value={form.smoking} onChange={v=>F("smoking",v)}/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Alcohol *</SL>
          <BtnGrp D={D} options={["Never","Occasionally","Weekly","Frequently"]} value={form.alcohol} onChange={v=>F("alcohol",v)}/>
        </GCard>
        <GCard D={D}>
          <SL D={D}>Typical Stress Level *</SL>
          <BtnGrp D={D} options={["Low","Moderate","High","Very High"]} value={form.stressBaseline} onChange={v=>F("stressBaseline",v)}/>
        </GCard>
      </>}

      {step===4 && <>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Diet Type *</SL>
          <BtnGrp D={D} options={["Vegetarian","Non-Vegetarian","Eggetarian","Vegan","Jain"]} value={form.diet} onChange={v=>F("diet",v)}/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Protein Sources You Eat *</SL>
          <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
            {PROTEIN_OPTS.map(p=>{const sel=form.proteins.includes(p);return <button key={p} onClick={()=>toggleProtein(p)} style={{padding:"8px 14px",borderRadius:20,border:`2px solid ${sel?D.g:D.brd}`,background:sel?D.gG:"transparent",color:sel?D.g:D.ts,fontWeight:sel?700:400,fontSize:12,cursor:"pointer"}}>{p}</button>;})}
          </div>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Preferred Meals Per Day *</SL>
          <BtnGrp D={D} options={["2","3","4","5+"]} value={form.mealsPerDay} onChange={v=>F("mealsPerDay",v)}/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Foods You Dislike Or Won't Eat *</SL>
          <Ta D={D} value={form.foodDislikes} onChange={v=>F("foodDislikes",v)} placeholder="e.g. no mushrooms, can't stand bland food, hate oats, or 'None'..." rows={2}/>
        </GCard>
        <GCard D={D}>
          <SL D={D}>Cooking Access *</SL>
          <BtnGrp D={D} options={["Cook At Home","Have A Cook","Mostly Eat Out","Office Meals","Mixed"]} value={form.cookingAccess} onChange={v=>F("cookingAccess",v)}/>
        </GCard>
      </>}

      {step===5 && <>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Exercise Experience *</SL>
          <BtnGrp D={D} options={["Complete Beginner","Some Experience","Exercised Before, Long Break","Currently Exercising"]} value={form.trainingExp} onChange={v=>F("trainingExp",v)}/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Equipment Access *</SL>
          <BtnGrp D={D} options={["Full Gym","Home Gym (Basic)","Bodyweight Only","Hotel/Travel Gym"]} value={form.equipment} onChange={v=>F("equipment",v)}/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Preferred Exercise Time *</SL>
          <BtnGrp D={D} options={["Early Morning","Morning","Afternoon","Evening","Night"]} value={form.workoutTime} onChange={v=>F("workoutTime",v)}/>
        </GCard>
        <GCard D={D}>
          <SL D={D}>Physical Limitations For Exercise *</SL>
          <Ta D={D} value={form.physicalLimits} onChange={v=>F("physicalLimits",v)} placeholder="Anything Ram should account for when programming your exercises, or 'None' if not applicable" rows={3}/>
        </GCard>
      </>}

      {step===6 && <>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Primary Goal *</SL>
          <Ta D={D} value={form.goal} onChange={v=>F("goal",v)} placeholder="What are you here to achieve? Fat loss, strength, a wedding deadline, general health..." rows={3}/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Target Timeline *</SL>
          <Ti D={D} value={form.targetTimeline} onChange={v=>F("targetTimeline",v)} placeholder="e.g. 6 months, before a wedding in March, no fixed deadline"/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>What's motivating you right now to change? *</SL>
          <Ta D={D} value={form.motivation} onChange={v=>F("motivation",v)} placeholder="Health scare, energy levels, an event, your kids, career confidence — what's the trigger right now?" rows={3}/>
        </GCard>
        <GCard D={D} style={{marginBottom:12}}>
          <SL D={D}>Biggest Obstacle In The Past *</SL>
          <Ta D={D} value={form.obstacle} onChange={v=>F("obstacle",v)} placeholder="What's derailed you before? Travel, consistency, motivation, plateaus..." rows={3}/>
        </GCard>
        <GCard D={D} style={{background:D.c3,border:`1.5px solid ${D.acc}30`}}>
          <div style={{fontSize:10,color:D.acc,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:8}}>Your Real WHY *</div>
          <div style={{fontSize:12,color:D.ts,lineHeight:1.6,marginBottom:10}}>This is the most important answer in this form. Go beyond the goal — what will change in your life, your relationships, your confidence when you achieve this?</div>
          <Ta D={D} value={form.why||""} onChange={v=>F("why",v)} placeholder="e.g. I want the energy to play with my kids without getting breathless. I want to feel like myself again in formal clothes. I don't want to be the unhealthy one in the room anymore..." rows={4}/>
        </GCard>
      </>}
      {step===7 && <>
        <div style={{background:D.amG,borderRadius:12,padding:"10px 14px",marginBottom:14,border:`1px solid ${D.brd}`}}>
          <div style={{fontSize:11,color:D.ts,lineHeight:1.5}}>Use a measuring tape. Measure in the morning before eating. <strong style={{color:D.t}}>All measurements are mandatory (*).</strong></div>
        </div>
        {[
          {k:"mArms",l:"Arms *",guide:"Flexed bicep, widest point, mid-upper arm"},
          {k:"mWaist",l:"Waist *",guide:"Belly button level, normal exhale, relaxed"},
          {k:"mQuads",l:"Quads *",guide:"Upper thigh, widest point, standing straight"},
          {k:"mChest",l:"Chest *",guide:"Nipple line, normal breath, arms down"},
          {k:"mShoulders",l:"Shoulders *",guide:"Widest point across both deltoids"},
          {k:"mHips",l:"Hips *",guide:"Widest point around the buttocks"},
          {k:"mNeck",l:"Neck *",guide:"Just below the Adam's apple, level all around"},
        ].map(({k,l,guide})=>(
          <GCard key={k} D={D} style={{marginBottom:10}}>
            <div style={{fontSize:13,color:D.t,fontWeight:600,marginBottom:2}}>{l} ({form.measUnit})</div>
            <div style={{fontSize:10,color:D.ts,marginBottom:8,fontStyle:"italic"}}>{guide}</div>
            <Ti D={D} type="number" value={form[k]||""} onChange={v=>F(k,v)} placeholder={form.measUnit==="inches"?"e.g. 12.5":"e.g. 88"}/>
          </GCard>
        ))}
      </>}

      {step===8 && <>
        <GCard D={D} style={{marginBottom:12,background:D.c3,border:`1px solid ${D.acc}30`}}>
          <div style={{fontSize:11,color:D.ts,lineHeight:1.7}}>Take photos this morning — empty stomach, before eating, relaxed pose, plain background. <strong style={{color:D.t}}>All views are optional</strong> but give Ram the clearest Day 1 picture.</div>
        </GCard>
        {[["Front","photoFront"],["Side","photoSide"],["Back","photoBack"]].map(([label,key])=>(
          <GCard key={key} D={D} style={{marginBottom:10}}>
            <div style={{fontSize:13,color:D.t,fontWeight:600,marginBottom:10}}>{label} View <span style={{fontSize:10,color:D.tm,fontWeight:400}}>(optional)</span></div>
            {form[key]
              ? <div style={{position:"relative"}}><img src={form[key]} style={{width:"100%",borderRadius:8,maxHeight:200,objectFit:"cover"}} alt={label}/><button onClick={()=>F(key,null)} style={{position:"absolute",top:8,right:8,background:"rgba(0,0,0,0.6)",border:"none",borderRadius:"50%",width:28,height:28,color:"white",fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button></div>
              : <label style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,padding:28,background:D.c2,borderRadius:12,border:`2px dashed ${D.brd}`,cursor:"pointer"}}>
                  <Ic.Camera c={D.tm} sz={24}/>
                  <span style={{fontSize:12,color:D.tm}}>Tap to upload</span>
                  <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(f){const r=new FileReader();r.onload=ev=>F(key,ev.target.result);r.readAsDataURL(f);}}}/>
                </label>
            }
          </GCard>
        ))}
        <GCard D={D} style={{padding:"14px 16px",background:D.c3}}>
          <div style={{fontSize:11,color:D.ts,lineHeight:1.6}}>Once you submit, Ram will review your details and reach out to schedule your onboarding call. Your transformation starts here.</div>
        </GCard>
      </>}
    </div>

    <div style={{padding:"0 20px 24px",display:"flex",flexDirection:"column",gap:10,flexShrink:0}}>
      {submitError && (
        <div style={{background:D.rG,border:`1px solid ${D.r}`,borderRadius:12,padding:"10px 14px",color:D.r,fontSize:12,fontWeight:600,textAlign:"center"}}>
          {submitError}
        </div>
      )}
      <div style={{display:"flex",gap:10}}>
        {step>0 && <button onClick={()=>setStep(s=>s-1)} style={{flex:1,padding:15,background:"transparent",border:`1.5px solid ${D.brd}`,borderRadius:14,fontSize:14,fontWeight:700,color:D.ts,cursor:"pointer"}}>Back</button>}
        {step<steps.length-1
          ? <button onClick={()=>canNext&&setStep(s=>s+1)} disabled={!canNext} style={{flex:2,padding:15,background:canNext?D.acc:D.brd,border:"none",borderRadius:14,fontSize:14,fontWeight:700,color:"white",cursor:canNext?"pointer":"not-allowed",opacity:canNext?1:0.6}}>Continue</button>
          : <button onClick={submit} disabled={!canNext || submitting} style={{flex:2,padding:15,background:canNext&&!submitting?D.g:D.brd,border:"none",borderRadius:14,fontSize:14,fontWeight:700,color:canNext&&!submitting?"#0d1b3e":D.tm,cursor:canNext&&!submitting?"pointer":"not-allowed",boxShadow:canNext&&!submitting?`0 0 20px ${D.gG}`:"none"}}>{submitting ? "Creating Account..." : "Finish & Enter Portal →"}</button>}
      </div>
    </div>
  </div>;
}

function LoginScreen({D,onPortal,onCoach}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleEmailLogin = async (e) => {
    e?.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setAuthError("");
    const { user, token, error } = await loginWithEmail(email, password);
    setLoading(false);
    if (error) {
      setAuthError(error);
    } else {
      let isCoach = false;
      try {
        const me = await fetchMe();
        isCoach = me.role === "coach";
      } catch {
        isCoach = (email.toLowerCase().trim() === "ram@leanfit.io");
      }
      if (isCoach) {
        onCoach();
      } else {
        onPortal(user, email);
      }
    }
  };

  return <div style={{minHeight:"100vh",background:D.bg,display:"flex",flexDirection:"column",fontFamily:"-apple-system,system-ui,sans-serif",position:"relative",overflow:"hidden"}}>
    <div style={{position:"absolute",top:-80,left:"30%",width:300,height:300,borderRadius:"50%",background:`radial-gradient(circle,${D.accG} 0%,transparent 70%)`,pointerEvents:"none"}}/>
    <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"space-between",padding:"48px 24px 36px",position:"relative"}}>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center"}}>
        <div style={{marginBottom:18}}><LFLogo D={D}/></div>
        <div style={{fontSize:44,fontWeight:900,color:D.t,lineHeight:0.95,letterSpacing:"-2px",marginBottom:12}}>YOUR<br/>PORTAL.</div>
        <div style={{fontSize:12.5,color:D.ts,lineHeight:1.6,marginBottom:18,maxWidth:280}}>Daily check-ins. Every metric.<br/>Fully visualised. Built for high performers.</div>
        
        {/* Feature Pills */}
        <div style={{display:"flex",flexWrap:"wrap",justifyContent:"center",gap:6,maxWidth:320}}>
          {["Check-in","Progress","Wins","Body fat","Inch loss","Measurements"].map(t=>(
            <span key={t} style={{background:D.c1,border:`1px solid ${D.brd}`,borderRadius:20,padding:"5px 12px",fontSize:11,fontWeight:600,color:D.acc}}>{t}</span>
          ))}
        </div>

        {/* Upward Trendline Graph (matching user screenshot) */}
        <div style={{width:"100%",display:"flex",justifyContent:"center",padding:"14px 0 10px"}}>
          <svg width="150" height="75" viewBox="0 0 150 75" fill="none" xmlns="http://www.w3.org/2000/svg" style={{opacity:0.9,filter:"drop-shadow(0 0 14px rgba(59,130,246,0.6))"}}>
            <path d="M15 58 L45 42 L68 50 L95 26 L118 34 L138 15" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="138" cy="15" r="5" fill="#3b82f6"/>
          </svg>
        </div>
      </div>

      <div>
        {authError && (
          <div style={{padding:"10px 14px",borderRadius:10,background:D.rG,border:`1px solid ${D.r}40`,color:D.r,fontSize:12,fontWeight:600,marginBottom:12}}>
            {authError}
          </div>
        )}
        <form onSubmit={handleEmailLogin} style={{display:"flex",flexDirection:"column",gap:12}}>
          {/* Card-style Email Input (matching user screenshot) */}
          <div style={{background:D.c1,border:`1.5px solid ${D.inpBrd}`,borderRadius:16,padding:"10px 14px"}}>
            <div style={{fontSize:11,fontWeight:500,color:D.ts,marginBottom:4}}>Email</div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <Ic.Mail c={D.ts} sz={16}/>
              <input 
                type="email" 
                placeholder="name@example.com" 
                value={email} 
                autoComplete="username"
                onChange={e=>setEmail(e.target.value)} 
                style={{width:"100%",background:"transparent",border:"none",color:D.t,fontSize:14,fontWeight:600,outline:"none"}}
              />
            </div>
          </div>

          {/* Card-style Password Input (matching user screenshot) */}
          <div style={{background:D.c1,border:`1.5px solid ${D.inpBrd}`,borderRadius:16,padding:"10px 14px"}}>
            <div style={{fontSize:11,fontWeight:500,color:D.ts,marginBottom:4}}>Password</div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <Ic.Lock c={D.ts} sz={16}/>
              <input 
                type="password" 
                placeholder="••••••••" 
                value={password} 
                autoComplete="current-password"
                onChange={e=>setPassword(e.target.value)} 
                style={{width:"100%",background:"transparent",border:"none",color:D.t,fontSize:14,fontWeight:600,outline:"none"}}
              />
            </div>
          </div>

          <button type="submit" disabled={loading || !email || !password} style={{width:"100%",padding:16,background:D.acc,border:"none",borderRadius:14,fontSize:15,fontWeight:700,color:"white",cursor:loading||!email||!password?"not-allowed":"pointer",opacity:loading||!email||!password?0.7:1,boxShadow:`0 0 24px ${D.accG}`,marginTop:4}}>
            {loading ? "Signing In..." : "Sign In to Portal"}
          </button>
        </form>
      </div>
    </div>
  </div>;
}

/* ═══ ROOT APP ═══════════════════════════════════════════════ */
function App() {
  const [theme,setTheme]=useState("dark");
  const [authLoading,setAuthLoading]=useState(true);
  const [isCoachUser,setIsCoachUser]=useState(false);
  const [stage,setStage]=useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("onboard") === "true" || params.get("join") === "true" || window.location.hash === "#onboard") {
      return "onboarding";
    }
    return localStorage.getItem("leanfit_stage") || "login";
  });

  const updateStage = (newStage) => {
    setStage(newStage);
    try {
      if (newStage && newStage !== "login") {
        localStorage.setItem("leanfit_stage", newStage);
      } else {
        localStorage.removeItem("leanfit_stage");
      }
    } catch (_) {}
  };

  const [tab,setTab]=useState("checkin");
  const [data,setData]=useState([]);
  const [measurements,setMeasurements]=useState([]);
  const [weightUnit,setWeightUnit]=useState(null);
  const [measUnit,setMeasUnit]=useState("cm"); // locked from onboarding
  const [onboardingData,setOnboardingData]=useState(null);
  const [plans,setPlans]=useState({nutrition:null,workout:null});
  const [clientProfile,setClientProfile]=useState(() => {
    const user = auth.currentUser;
    const name = user?.displayName || (user?.email ? user.email.split("@")[0].replace(/[0-9._]/g, '').replace(/^./, c => c.toUpperCase()) : "");
    return {
      name: name || "",
      phase: "Phase I: Rebuild",
      startDate: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
      startW: 70.0,
      height: 175,
      prog: "LeanFit 6-Month Transformation",
      phaseWeeks: 12,
      coachStepsGoal: 8000
    };
  });
  const D=THEMES[theme];
  const toggle=()=>setTheme(t=>t==="dark"?"light":"dark");
  const displayName = clientProfile.name || auth.currentUser?.displayName || (auth.currentUser?.email ? auth.currentUser.email.split("@")[0].replace(/[0-9._]/g, '').replace(/^./, c => c.toUpperCase()) : "Client");
  const headerLabel={checkin:`Morning, ${displayName}`,dashboard:"Progress Dashboard",body:"Body Metrics",wins:"Your Wins",me:"My Profile"}[tab];
  const [showNotifs,setShowNotifs]=useState(false);

  useEffect(() => {
    // Secret onboarding link: e.g. https://portal.leanfit.in/?onboard=true or #onboard
    const params = new URLSearchParams(window.location.search);
    if (params.get("onboard") === "true" || params.get("join") === "true" || window.location.hash === "#onboard") {
      updateStage("onboarding");
    }
  }, []);

  const loadData = useCallback(async (emailHint) => {
    try {
      const res = await fetchClientData();
      if (res.checkins) {
        setData(res.checkins);
      }
      if (res.measurements) {
        setMeasurements(res.measurements);
      }
      if (res.plans) {
        setPlans({
          nutrition: res.plans.nutrition,
          workout: res.plans.workout
        });
      }
      if (res.client) {
        if (res.client.weightUnit) setWeightUnit(res.client.weightUnit);
        if (res.client.measUnit) setMeasUnit(res.client.measUnit);
        const currentEmail = emailHint || auth.currentUser?.email || "";
        const fallbackName = currentEmail ? currentEmail.split("@")[0].replace(/[0-9._]/g, '').replace(/^./, c => c.toUpperCase()) : "Client";
        const resolvedName = (res.client.name && res.client.name !== "Client") ? res.client.name : fallbackName;
        setClientProfile(p => ({ ...p, ...res.client, name: resolvedName }));
      }
    } catch (err) {
      console.warn("Client data sync:", err.message);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const derivedName = user.displayName || (user.email ? user.email.split("@")[0].replace(/[0-9._]/g, '').replace(/^./, c => c.toUpperCase()) : "Client");
        setClientProfile(p => ({
          ...p,
          name: (p.name && p.name !== "Client") ? p.name : derivedName,
          email: user.email
        }));

        let isCoach = (user.email?.toLowerCase().trim() === "ram@leanfit.io" || user.email?.toLowerCase().trim() === "coach@leanfit.io");
        try {
          const me = await fetchMe();
          if (me?.role === "coach") isCoach = true;
        } catch (_) {}
        setIsCoachUser(isCoach);

        const params = new URLSearchParams(window.location.search);
        const isOnboard = params.get("onboard") === "true" || params.get("join") === "true" || window.location.hash === "#onboard";

        if (!isOnboard) {
          const savedStage = localStorage.getItem("leanfit_stage");
          let nextStage;
          if (isCoach) {
            nextStage = (savedStage === "portal") ? "portal" : "coach";
          } else {
            nextStage = "portal";
          }
          setStage(nextStage);
          try { localStorage.setItem("leanfit_stage", nextStage); } catch (_) {}
        }

        loadData(user.email);
      } else {
        setData([]);
        setMeasurements([]);
        setOnboardingData(null);
        setPlans({ nutrition: null, workout: null });
        setClientProfile({
          name: "",
          phase: "Phase I: Rebuild",
          startDate: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
          startW: 70.0,
          height: 175,
          prog: "LeanFit 6-Month Transformation",
          phaseWeeks: 12,
          coachStepsGoal: 8000
        });
        setIsCoachUser(false);
        try { localStorage.removeItem("leanfit_stage"); } catch (_) {}
        const params = new URLSearchParams(window.location.search);
        if (params.get("onboard") !== "true" && params.get("join") !== "true" && window.location.hash !== "#onboard") {
          setStage("login");
        }
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, [loadData]);

  const handlePortalEnter = (user, loginEmail) => {
    const currentEmail = loginEmail || user?.email || auth.currentUser?.email || "";
    const derivedName = user?.displayName || (currentEmail ? currentEmail.split("@")[0].replace(/[0-9._]/g, '').replace(/^./, c => c.toUpperCase()) : "Client");
    setClientProfile(p => ({
      ...p,
      name: derivedName,
      email: currentEmail
    }));
    updateStage("portal");
    loadData(currentEmail);
  };

  // Dynamic notification schedule:
  const dayCount = data.length + 1;
  const curWeek = Math.max(1, Math.ceil(dayCount / 7));
  const daysUntilMeas = ((7 - ((dayCount - 1) % 7)) % 7);
  const isMeasDay = daysUntilMeas === 0;
  const showMeasReminder = !isMeasDay && daysUntilMeas <= 3;

  const daysUntilPhoto = ((14 - ((dayCount - 1) % 14)) % 14);
  const isPhotoDay = daysUntilPhoto === 0;
  const showPhotoReminder = !isPhotoDay && daysUntilPhoto <= 3;

  const notifs = [
    ...(plans.nutrition ? [{ t: "Nutrition plan is ready", s: "Ram just pushed your new meal plan — check My Profile.", i: Ic.SaladBowl, c: D.g }] : []),
    ...(plans.workout ? [{ t: "Exercise plan is ready", s: "Ram just pushed your new workout programme — check My Profile.", i: Ic.Dumbbell, c: D.pur }] : []),
    ...(isMeasDay ? [{ t: "Weekly Measurements Due Today!", s: "Please log all 7 measurements with today's check-in.", i: Ic.History, c: D.am }] : []),
    ...(showMeasReminder ? [{ t: `Measurement Day in ${daysUntilMeas} Day${daysUntilMeas > 1 ? "s" : ""}`, s: `Have your measuring tape ready for Day ${dayCount + daysUntilMeas}.`, i: Ic.History, c: D.am }] : []),
    ...(isPhotoDay ? [{ t: "Progress Photos Due Today!", s: "Bi-weekly photos are due today (Front, Side, Back).", i: Ic.Camera, c: D.pur }] : []),
    ...(showPhotoReminder ? [{ t: `Progress Photos in ${daysUntilPhoto} Day${daysUntilPhoto > 1 ? "s" : ""}`, s: `Bi-weekly photos due in ${daysUntilPhoto} days. Empty stomach, morning.`, i: Ic.Camera, c: D.pur }] : [])
  ];

  if (authLoading) {
    return (
      <div style={{minHeight:"100vh",background:D.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"-apple-system,system-ui,sans-serif"}}>
        <LFLogo D={D}/>
        <div style={{marginTop:24,fontSize:13,color:D.ts,fontWeight:600,letterSpacing:1,display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:D.acc}}/>
          Loading portal...
        </div>
      </div>
    );
  }

  if(stage==="login") return <LoginScreen D={D} onPortal={handlePortalEnter} onCoach={()=>updateStage("coach")}/>;
  if(stage==="onboarding") return <OnboardingScreen D={D} onComplete={async (f, acc)=>{
    setMeasUnit(f.measUnit||"cm");
    setOnboardingData(f);
    setData([]);
    if (acc) {
      setClientProfile(p => ({
        ...p,
        name: acc.name || f.name,
        startW: acc.startW || f.weight,
        latestW: acc.startW || f.weight,
        email: acc.email,
        height: acc.height || f.height,
        weightUnit: acc.weightUnit || f.weightUnit || "kg",
        measUnit: acc.measUnit || f.measUnit || "cm",
        phase: "Phase I: Rebuild",
        phaseWeeks: 12,
        startDate: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
      }));
      if (acc.weightUnit) setWeightUnit(acc.weightUnit);
      if (acc.measUnit) setMeasUnit(acc.measUnit);
      try {
        await loginWithEmail(acc.email, acc.password);
      } catch (_) {}
    }
    updateStage("portal");
    loadData();
  }}/>;
  if(stage==="coach") return <CoachDashboard D={D} theme={theme} toggleTheme={toggle} onBack={()=>updateStage("portal")} plans={plans} setPlans={setPlans}/>;

  return (
    <div style={{maxWidth:420,margin:"0 auto",height:"100vh",display:"flex",flexDirection:"column",background:D.bg,fontFamily:"-apple-system,system-ui,sans-serif",overflow:"hidden",position:"relative"}}>
      <div style={{background:`linear-gradient(135deg,${D.accD},${D.acc})`,padding:"18px 20px 22px",borderRadius:"0 0 26px 26px",flexShrink:0,display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:`0 6px 18px ${D.accG}`}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}><LFLogo D={{...D,t:"#ffffff",ts:"rgba(255,255,255,0.7)",g:"#c9ef5e"}} compact/><div><div style={{fontSize:9,color:"rgba(255,255,255,0.75)",fontWeight:700,letterSpacing:2,textTransform:"uppercase"}}>{clientProfile.phase || "Phase I"} · Week {curWeek}</div><div style={{fontSize:15,fontWeight:800,color:"#ffffff",marginTop:1}}>{headerLabel}</div></div></div>
        <div style={{display:"flex",alignItems:"center",gap:8,position:"relative"}}>
          {isCoachUser && (
            <button onClick={()=>updateStage("coach")} style={{padding:"5px 10px",borderRadius:8,background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.3)",color:"#ffffff",fontSize:10,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
              Coach View →
            </button>
          )}
          <button onClick={()=>setShowNotifs(s=>!s)} style={{width:34,height:34,borderRadius:"50%",background:"rgba(255,255,255,0.16)",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",position:"relative"}}>
            <Ic.Bell c="#ffffff" sz={15}/>
            {notifs.length>0 && <div style={{position:"absolute",top:6,right:7,width:7,height:7,borderRadius:"50%",background:D.r,border:"1.5px solid white"}}/>}
          </button>
          <button onClick={toggle} style={{width:34,height:34,borderRadius:"50%",background:"rgba(255,255,255,0.16)",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>{theme==="dark"?<Ic.Sun c="#ffffff" sz={14}/>:<Ic.Moon c="#ffffff" sz={14}/>}</button>
          {showNotifs && (
            <div style={{position:"absolute",top:42,right:0,width:280,background:D.c1,borderRadius:14,border:`1px solid ${D.brd}`,boxShadow:"0 10px 30px rgba(0,0,0,0.3)",zIndex:20,overflow:"hidden"}}>
              <div style={{padding:"10px 14px",borderBottom:`1px solid ${D.brd}`,fontSize:11,fontWeight:700,color:D.t}}>Notifications</div>
              {notifs.map((n,i)=>(
                <div key={i} style={{display:"flex",gap:10,padding:"11px 14px",borderBottom:i<notifs.length-1?`1px solid ${D.brd}`:"none"}}>
                  <div style={{width:30,height:30,borderRadius:9,background:`${n.c}18`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><n.i c={n.c} sz={15}/></div>
                  <div><div style={{fontSize:12,fontWeight:700,color:D.t}}>{n.t}</div><div style={{fontSize:10.5,color:D.ts,marginTop:2,lineHeight:1.4}}>{n.s}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto"}}>
        {tab==="checkin"   && <CheckIn   D={D} data={data} setData={setData} onComplete={()=>setTab("dashboard")} weightUnit={weightUnit} setWeightUnit={setWeightUnit} measUnit={measUnit} clientProfile={clientProfile}/>}
        {tab==="dashboard" && <Dashboard D={D} data={data} weightUnit={weightUnit} clientProfile={clientProfile}/>}
        {tab==="body"      && <BodyScreen D={D} measurements={measurements} clientProfile={clientProfile}/>}
        {tab==="wins"      && <WinsScreen D={D} clientProfile={clientProfile} data={data}/>}
        {tab==="me"        && <MeScreen   D={D} theme={theme} toggleTheme={toggle} weightUnit={weightUnit} setWeightUnit={setWeightUnit} data={data} onboardingData={onboardingData} setOnboardingData={setOnboardingData} plans={plans} clientProfile={clientProfile}/>}
      </div>
      <BottomNav D={D} tab={tab} setTab={setTab}/>
    </div>
  );
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("LeanFit Portal error caught by boundary:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{padding:24,color:"#ef4444",background:"#060b16",minHeight:"100vh",fontFamily:"-apple-system,system-ui,sans-serif",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center"}}>
          <div style={{fontSize:40,marginBottom:12}}>⚠️</div>
          <div style={{fontSize:18,fontWeight:800,color:"#fff",marginBottom:8}}>Something went wrong</div>
          <div style={{fontSize:12,color:"#94a3b8",maxWidth:450,marginBottom:20,lineHeight:1.5}}>
            {this.state.error?.message || "An unexpected error occurred while rendering the portal."}
          </div>
          <button 
            onClick={() => { localStorage.clear(); window.location.reload(); }}
            style={{padding:"10px 20px",borderRadius:10,background:"#3b82f6",color:"#fff",border:"none",fontWeight:700,fontSize:13,cursor:"pointer"}}
          >
            Reset Session & Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
