import type { ComponentProps } from "react";
import { policyHighlights, storePolicy } from "@clothing-brand/shared";
import { Header } from "../../header";
import { MihrabPromiseStrip } from "../mihrab/promise-strip";

/** The Tahafi header: the classic header on cream under an olive strip of the store's own delivery promises (the same
 * rotating strip as the mihrab preset; ink-950 is olive in this theme), so every page opens on the logo's ground. */
export function TahafiHeader(props: ComponentProps<typeof Header>) {
  const promises = policyHighlights(storePolicy(props.settings)).map((line) => line.label);
  return (
    <>
      {promises.length > 0 && <MihrabPromiseStrip promises={promises} />}
      <Header {...props} />
    </>
  );
}
