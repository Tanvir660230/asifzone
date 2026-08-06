"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot, Copy, Sparkles } from "lucide-react";
import type { AiContentType } from "@clothing-brand/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/admin/page-header";
import { RankedBarList } from "@/components/admin/ranked-bar-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import * as analyticsApi from "@/lib/api/admin-analytics";
import * as aiApi from "@/lib/api/ai";
import { ApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { useCurrentAdmin } from "@/hooks/use-current-admin";

const CONTENT_TYPES: Array<{ value: AiContentType; label: string }> = [
  { value: "product_description", label: "Product description" },
  { value: "seo_title", label: "SEO title" },
  { value: "meta_description", label: "Meta description" },
  { value: "seo_keywords", label: "SEO keywords" },
  { value: "marketing_copy", label: "Marketing copy" },
  { value: "email_copy", label: "Email copy" },
  { value: "campaign_suggestion", label: "Campaign suggestion" },
];

const PRODUCT_TYPES = new Set<AiContentType>(["product_description", "seo_title", "meta_description", "seo_keywords"]);

export default function AiAssistantPage() {
  const { data: aiStatus } = useQuery({ queryKey: ["ai-status"], queryFn: aiApi.getAiStatus });
  const { data: currentAdmin } = useCurrentAdmin();
  const isOwner = currentAdmin?.admin.role === "OWNER";
  const { data: slowMoving } = useQuery({ queryKey: ["ai-slow-moving"], queryFn: () => analyticsApi.getSlowMovingProducts(30, 8) });
  const { data: bestSelling } = useQuery({ queryKey: ["ai-best-selling"], queryFn: () => analyticsApi.getBestSellingPrediction(8) });
  const { data: demandForecast } = useQuery({ queryKey: ["ai-demand-forecast"], queryFn: () => analyticsApi.getDemandForecast(14, 8) });

  const [type, setType] = useState<AiContentType>("product_description");
  const [productName, setProductName] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [keyPoints, setKeyPoints] = useState("");
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [result, setResult] = useState("");

  const generateMutation = useMutation({
    mutationFn: () =>
      aiApi.generateAiContent({
        type,
        productName: productName || undefined,
        category: category || undefined,
        brand: brand || undefined,
        keyPoints: keyPoints || undefined,
        topic: topic || undefined,
        audience: audience || undefined,
        tone: tone || undefined,
      }),
    onSuccess: (data) => setResult(data.text),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Generation failed"),
  });

  const isProductType = PRODUCT_TYPES.has(type);
  const configured = aiStatus?.configured ?? false;

  return (
    <div className="space-y-6">
      <PageHeader title="AI Admin Assistant" description="Smart alerts and AI-generated store content, in one place." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Slow moving products (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            {slowMoving && (
              <RankedBarList
                emptyLabel="Nothing sitting idle right now."
                items={slowMoving.products.map((p) => ({
                  key: p.id,
                  label: p.name,
                  value: p.totalStock,
                  valueLabel: `${p.unitsSold} sold`,
                  subLabel: `${p.totalStock} in stock`,
                }))}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Best-selling prediction</CardTitle>
          </CardHeader>
          <CardContent>
            {bestSelling && (
              <RankedBarList
                emptyLabel="Not enough sales trend data yet."
                items={bestSelling.products
                  .filter((p) => p.recentUnits > 0)
                  .map((p) => ({
                    key: p.name,
                    label: p.name,
                    value: Math.max(p.growthPct, 0),
                    valueLabel: `${p.growthPct >= 0 ? "+" : ""}${p.growthPct.toFixed(0)}%`,
                    subLabel: `${p.recentUnits} this week (was ${p.priorUnits})`,
                  }))}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Demand forecast — stockout risk</CardTitle>
          </CardHeader>
          <CardContent>
            {demandForecast && (
              <RankedBarList
                emptyLabel="No variants selling fast enough to project a stockout."
                items={demandForecast.variants.map((v) => ({
                  key: v.variantId,
                  label: `${v.productName} (${v.sku})`,
                  value: v.projected7d,
                  valueLabel:
                    v.daysUntilStockout < 999 ? `~${Math.round(v.daysUntilStockout)}d left` : "stable",
                  subLabel: `${v.stock} in stock · ~${v.projected7d.toFixed(1)} projected to sell in 7d`,
                }))}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles size={18} className="text-brass-500" />
            AI content generator
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!configured ? (
            <div className="flex items-center gap-3 rounded-lg border border-ink-100 bg-cream-50 p-4 text-sm text-ink-600">
              <Bot size={18} className="shrink-0 text-brass-500" />
              <span>
                AI content generation is wired up but not turned on — set{" "}
                <code className="rounded bg-ink-100 px-1 py-0.5 text-xs">ANTHROPIC_API_KEY</code> on the API server to
                enable product descriptions, SEO copy, marketing copy, emails, and campaign ideas.
              </span>
            </div>
          ) : !isOwner ? (
            <div className="flex items-center gap-3 rounded-lg border border-ink-100 bg-cream-50 p-4 text-sm text-ink-600">
              <Bot size={18} className="shrink-0 text-brass-500" />
              <span>AI generation uses billed API usage, so it&rsquo;s restricted to store owners.</span>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ai-type">What do you want to generate?</Label>
                  <Select id="ai-type" value={type} onChange={(e) => setType(e.target.value as AiContentType)}>
                    {CONTENT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="ai-tone">Tone (optional)</Label>
                  <Input id="ai-tone" placeholder="e.g. warm and premium" value={tone} onChange={(e) => setTone(e.target.value)} />
                </div>

                {isProductType ? (
                  <>
                    <div>
                      <Label htmlFor="ai-product-name">Product name</Label>
                      <Input id="ai-product-name" value={productName} onChange={(e) => setProductName(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="ai-category">Category (optional)</Label>
                      <Input id="ai-category" value={category} onChange={(e) => setCategory(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="ai-brand">Brand (optional)</Label>
                      <Input id="ai-brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="ai-key-points">Key points (optional)</Label>
                      <Textarea
                        id="ai-key-points"
                        rows={2}
                        placeholder="Fabric, fit, care instructions — anything real to work in"
                        value={keyPoints}
                        onChange={(e) => setKeyPoints(e.target.value)}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="sm:col-span-2">
                      <Label htmlFor="ai-topic">
                        Topic {type === "campaign_suggestion" ? "(optional)" : ""}
                      </Label>
                      <Textarea
                        id="ai-topic"
                        rows={2}
                        placeholder="e.g. Eid collection launch, 20% off this weekend"
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="ai-audience">Audience (optional)</Label>
                      <Input id="ai-audience" placeholder="e.g. returning customers" value={audience} onChange={(e) => setAudience(e.target.value)} />
                    </div>
                  </>
                )}
              </div>

              <Button type="button" variant="brass" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
                <Sparkles size={14} /> {generateMutation.isPending ? "Generating…" : "Generate"}
              </Button>

              {result && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <Label>Result</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(result);
                        toast.success("Copied");
                      }}
                    >
                      <Copy size={12} /> Copy
                    </Button>
                  </div>
                  <Textarea rows={6} value={result} readOnly />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
