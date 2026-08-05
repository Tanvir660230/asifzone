import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { authRouter } from "./modules/auth/auth.routes";
import { categoryRouter } from "./modules/categories/category.routes";
import { attributeRouter } from "./modules/attributes/attribute.routes";
import { productRouter } from "./modules/products/product.routes";
import { orderRouter } from "./modules/orders/order.routes";
import { couponRouter } from "./modules/coupons/coupon.routes";
import { bundleRouter } from "./modules/bundles/bundle.routes";
import { returnRequestRouter } from "./modules/return-requests/return-request.routes";
import { redirectRouter } from "./modules/redirects/redirect.routes";
import { paymentRouter } from "./modules/payments/payment.routes";
import { flashSaleRouter } from "./modules/flash-sales/flash-sale.routes";
import { bannerRouter } from "./modules/banners/banner.routes";
import { socialLinkRouter } from "./modules/social-links/social-link.routes";
import { newsletterRouter } from "./modules/newsletter/newsletter.routes";
import { customerRouter } from "./modules/customers/customer.routes";
import { wishlistRouter } from "./modules/wishlist/wishlist.routes";
import { cartRouter } from "./modules/cart/cart.routes";
import { stockAlertRouter } from "./modules/stock-alerts/stock-alert.routes";
import { analyticsRouter } from "./modules/analytics/analytics.routes";
import { uploadRouter } from "./modules/uploads/upload.routes";
import { auditRouter } from "./modules/audit/audit.routes";
import { notificationRouter } from "./modules/notifications/notification.routes";
import { settingsRouter } from "./modules/settings/settings.routes";
import { errorHandler, notFoundHandler } from "./middlewares/error-handler";
import { auditMiddleware } from "./middlewares/audit";
import { csrfProtection } from "./middlewares/csrf";

export const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: env.webOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true })); // SSLCommerz posts callbacks as form-encoded
app.use(cookieParser());
app.use(morgan(env.nodeEnv === "development" ? "dev" : "combined"));
app.use(csrfProtection);
app.use(auditMiddleware);

app.use(`/${env.uploadsDir}`, express.static(env.uploadsDir, { maxAge: "30d" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRouter);
app.use("/api/categories", categoryRouter);
app.use("/api/attributes", attributeRouter);
app.use("/api/products", productRouter);
app.use("/api/orders", orderRouter);
app.use("/api/coupons", couponRouter);
app.use("/api/bundles", bundleRouter);
app.use("/api/return-requests", returnRequestRouter);
app.use("/api/redirects", redirectRouter);
app.use("/api/payments", paymentRouter);
app.use("/api/flash-sales", flashSaleRouter);
app.use("/api/banners", bannerRouter);
app.use("/api/social-links", socialLinkRouter);
app.use("/api/newsletter", newsletterRouter);
app.use("/api/customers", customerRouter);
app.use("/api/wishlist", wishlistRouter);
app.use("/api/cart", cartRouter);
app.use("/api/stock-alerts", stockAlertRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/uploads", uploadRouter);
app.use("/api/audit-logs", auditRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/settings", settingsRouter);

app.use(notFoundHandler);
app.use(errorHandler);
