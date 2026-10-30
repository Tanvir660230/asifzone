import type { ComponentProps } from "react";
import { policyHighlights, storePolicy } from "@clothing-brand/shared";
import { Header } from "../../header";
import { MihrabPromiseStrip } from "../mihrab/promise-strip";

/** The Tahafi header: the classic header on cream under an ink strip of the store's own delivery promises (the same
 * rotating strip as the mihrab preset, on ink-950). */
export function TahafiHeader(props: ComponentProps<typeof Header>) {
  const promises = policyHighlights(storePolicy(props.settings)).map((line) => line.label);
  return (
    <>
      {promises.length > 0 && <MihrabPromiseStrip promises={promises} />}
      <Header {...props} />
    </>
  );
}
