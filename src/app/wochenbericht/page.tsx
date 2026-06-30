import { redirect } from "next/navigation";

export default function WochenberichtPage() {
  redirect("/berichte?tab=wochenbericht");
}
