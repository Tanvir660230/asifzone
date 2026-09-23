/** Where "add a product" and "edit this product" go across the admin (and the storefront preview's "Back to editor"):
 * the step-by-step builder. The classic tabbed editor stays available at its own URLs, linked from the builder. */
export const PRODUCT_NEW_HREF = "/admin/products/wizard/new";
export const productEditHref = (id: string) => `/admin/products/wizard/${id}/edit`;

export const CLASSIC_PRODUCT_NEW_HREF = "/admin/products/new";
export const classicProductEditHref = (id: string) => `/admin/products/${id}/edit`;
