/**
 * The public walkthrough's fictional example (/preview): what the page shows, and the only
 * thing the assistant on that page may answer from. Nothing here is a real client or meeting.
 */
export type PreviewStep = { title: string; detail: string; items: string[] };

export const PREVIEW_STEPS: PreviewStep[] = [
  {
    title: "Before the meeting",
    detail: "Example: Cedar project review",
    items: [
      "Review the project goal and the previous action list.",
      "Agenda: progress, open questions and next steps.",
      "Ava receives the approved brief from the meeting owner.",
    ],
  },
  {
    title: "During the meeting",
    detail: "Example notes",
    items: [
      "The team reviewed the draft plan.",
      "One dependency needs clarification before the next review.",
      "Ava captures decisions and the action owners agreed in the meeting.",
    ],
  },
  {
    title: "After the meeting",
    detail: "Example action list",
    items: [
      "Project owner: clarify the open dependency.",
      "Review lead: prepare the next draft.",
      "Meeting owner: review the notes and follow-up actions.",
    ],
  },
];
