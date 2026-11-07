"use client";
import { useState } from "react";

const steps = [
  {title:"Before the meeting", detail:"Example: Cedar project review", items:["Review the project goal and the previous action list.","Agenda: progress, open questions and next steps.","Ava receives the approved brief from the meeting owner."]},
  {title:"During the meeting", detail:"Example notes", items:["The team reviewed the draft plan.","One dependency needs clarification before the next review.","Ava captures decisions and the action owners agreed in the meeting."]},
  {title:"After the meeting", detail:"Example action list", items:["Project owner: clarify the open dependency.","Review lead: prepare the next draft.","Meeting owner: review the notes and follow-up actions."]},
];
export default function PublicWalkthrough() {
  const [step,setStep]=useState(0);
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Meeting walkthrough">{steps.map((s,i)=><button key={s.title} role="tab" aria-selected={step===i} onClick={()=>setStep(i)} className={"rounded-lg px-4 py-2 text-sm "+(step===i?"bg-blue-600 text-white":"bg-slate-100 text-slate-700")}>{s.title}</button>)}</div>
    <div role="tabpanel" className="mt-6"><h2 className="text-xl font-semibold">{steps[step].detail}</h2><ul className="mt-4 list-disc space-y-3 pl-5 text-slate-600">{steps[step].items.map(t=><li key={t}>{t}</li>)}</ul></div>
    <p className="mt-6 text-xs text-slate-500">This walkthrough contains fictional information. It does not join a meeting, record audio or send messages.</p>
  </section>;
}
