import { redirect } from "next/navigation";

export default function MonatsberichtPage() {
  redirect("/berichte?tab=monatsbericht");
}
