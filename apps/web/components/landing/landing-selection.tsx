"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { isAvailable, type Product } from "@clothing-brand/shared";
import { useVariantOptions, type VariantOptions } from "@/components/storefront/variant-option-pickers";

interface LandingSelection {
  product: Product;
  options: VariantOptions;
  size: string | null;
  color: string | null;
  setSize: (size: string | null) => void;
  setColor: (color: string | null) => void;
  /** Some variant matching this (size, colour) can be bought now — null means "any". */
  sellable: (size: string | null, color: string | null) => boolean;
}

const Ctx = createContext<LandingSelection | null>(null);

/**
 * The colour and size the shopper has chosen on a landing page, shared by every part that shows or changes it: the
 * gallery (follows the colour), the colour showcase (sets it), and the order form (sets and submits it). The page's own
 * defaults win when they are still on sale; otherwise a choice is made only when there is just one sellable option.
 */
export function LandingSelectionProvider({
  product,
  defaultColor,
  defaultSize,
  children,
}: {
  product: Product;
  defaultColor?: string | null;
  defaultSize?: string | null;
  children: ReactNode;
}) {
  const options = useVariantOptions(product.variants, product.resolved?.variantDimensions);
  const sellable = (s: string | null, c: string | null) =>
    product.variants.some((v) => (s === null || v.size === s) && (c === null || v.color === c) && isAvailable(product.trackInventory, v.stock));
  // Only one option can actually be bought: it is chosen already, there is nothing to decide.
  const onlySellable = (values: string[], test: (v: string) => boolean) => {
    const ok = values.filter(test);
    return ok.length === 1 ? ok[0]! : null;
  };
  const pageColor = defaultColor && options.colors.includes(defaultColor) && sellable(null, defaultColor) ? defaultColor : null;
  const pageSize = defaultSize && options.sizes.includes(defaultSize) && sellable(defaultSize, pageColor) ? defaultSize : null;

  const [size, setSize] = useState<string | null>(pageSize ?? options.defaultSize ?? (options.showSizes ? onlySellable(options.sizes, (s) => sellable(s, null)) : null));
  const [color, setColor] = useState<string | null>(pageColor ?? options.defaultColor ?? (options.showColors ? onlySellable(options.colors, (c) => sellable(null, c)) : null));

  return <Ctx.Provider value={{ product, options, size, color, setSize, setColor, sellable }}>{children}</Ctx.Provider>;
}

export function useLandingSelection(): LandingSelection {
  const value = useContext(Ctx);
  if (!value) throw new Error("useLandingSelection needs a LandingSelectionProvider");
  return value;
}
