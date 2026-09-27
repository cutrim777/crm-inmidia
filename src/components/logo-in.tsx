import Image from "next/image";
import logo from "@/assets/logo-in.png";

/** In Mídia: a logo básica, só o "IN" sobre o cinza espacial. */
export function LogoIn({ className = "h-8 w-8 rounded-lg" }: { className?: string }) {
  return <Image src={logo} alt="In Mídia" className={`${className} object-cover`} priority />;
}
