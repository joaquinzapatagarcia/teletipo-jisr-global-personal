import test from "node:test";
import assert from "node:assert/strict";
import { dedupeArticles, scoreArticles } from "../scripts/update-indices.mjs";

const index = {base:50,keywords:{high:["attack"],medium:["risk"],down:["agreement"]}};
const policy = {minimumArticlesForMovement:2,maxLowEvidenceMove:1,newSignalWeight:0.3,shockSignalWeight:0.45};

test("deduplica por URL", () => {
  const articles = [{title:"A",url:"https://a.test/1",domain:"a.test"},{title:"A copy",url:"https://a.test/1?x=2",domain:"a.test"}];
  assert.equal(dedupeArticles(articles).length, 1);
});

test("el volumen neutral no aumenta por sí solo la tensión", () => {
  const articles = Array.from({length:6}, (_,i)=>({title:`Neutral ${i}`,url:`https://a.test/${i}`,domain:"a.test"}));
  assert.equal(scoreArticles(index, 50, articles, policy).value, 50);
});

test("la baja evidencia limita el movimiento", () => {
  const result = scoreArticles(index, 50, [{title:"Attack risk",url:"https://a.test/1",domain:"a.test"}], policy);
  assert.equal(result.value, 51);
});
