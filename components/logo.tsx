import Image from "next/image";
import { cn } from "cn";
import horizontalDark from "./brand/logo-horizontal-dark.png";
import horizontal from "./brand/logo-horizontal.png";
import mark from "./brand/logo-mark.png";
import stacked from "./brand/logo-stacked.png";

const ALT = "MaidCare Cleaning Service";

// The company logo. "horizontal" (house + wordmark side by side) for the
// header, "stacked" (wordmark under the house) for the sign-in page, "mark"
// (the house alone) for the collapsed sidebar. With
// `compact`, phones get just the house so the header fits.
export function Logo({
  variant = "horizontal",
  compact = false,
  className,
}: {
  variant?: "horizontal" | "stacked" | "mark";
  compact?: boolean;
  className?: string;
}) {
  if (variant === "mark") {
    return <Image src={mark} alt={ALT} preload className={cn("h-9 w-auto max-w-none", className)} />;
  }
  if (variant === "stacked") {
    return <Image src={stacked} alt={ALT} preload className={cn("h-auto w-56", className)} />;
  }
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)}>
      {/* the wordmark's black "Cleaning Service" becomes light in dark mode */}
      <Image
        src={horizontal}
        alt={ALT}
        preload
        className={cn("h-13 w-auto max-w-none dark:hidden", compact && "max-sm:hidden")}
      />
      <Image
        src={horizontalDark}
        alt={ALT}
        loading="eager"
        className={cn("hidden h-13 w-auto max-w-none dark:block", compact && "max-sm:hidden!")}
      />
      {compact && <Image src={mark} alt={ALT} preload className="h-10 w-auto max-w-none sm:hidden" />}
    </span>
  );
}
