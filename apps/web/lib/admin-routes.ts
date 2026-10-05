/** Where "add a product" and "edit this product" go across the admin and the storefront: the Product Builder, the one
 * product editor. The old /admin/products/wizard/* URLs redirect here. */
export const PRODUCT_NEW_HREF = "/admin/products/new";
export const productEditHref = (id: string) => `/admin/products/${id}/edit`;
