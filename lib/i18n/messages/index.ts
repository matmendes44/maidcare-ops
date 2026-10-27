import type { Locale } from "../config";
import { enUS, type Messages } from "./en-US";
import { ptBR } from "./pt-BR";

export type { Messages };
export const messages: Record<Locale, Messages> = { "en-US": enUS, "pt-BR": ptBR };
