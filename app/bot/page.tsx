import Stage from "@/components/Stage";

/**
 * The page Recall loads and streams into the meeting as Ava's camera.
 *
 * Open it yourself to preview the layout — it will render, but the caption socket only
 * exists inside a Recall bot, so she will sit there listening to nothing.
 */
export const metadata = { title: "Ava" };

export default function BotPage() {
  return <Stage />;
}
