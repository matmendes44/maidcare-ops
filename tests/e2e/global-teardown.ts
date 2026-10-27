import { fixture } from "./support/helpers";

export default async function globalTeardown() {
  fixture("cleanup");
}
