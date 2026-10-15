-- A second category photo for wide tiles (16:10), beside the portrait one (4:5): the homepage category grid picks
-- whichever matches the tile it is drawing, instead of cropping one photo into both shapes.
ALTER TABLE "Category" ADD COLUMN "wideImageUrl" TEXT;
