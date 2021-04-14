"use strict";

var chai = require("chai");
var chaiAsPromised = require("chai-as-promised");
var expect = chai.expect;
chai.use(chaiAsPromised);
chai.use(require("chai-things"));

var wordNet = require("../src/index.js")("../data/to-json", true);

describe("wordNet", function () {
	describe("Word", function tests() {
		var word;
		it("creates a new word", function test(done) {
			word = new wordNet.Word("king");
			expect(word).to.be.instanceOf(wordNet.Word);
			done();
		});
	});
	describe("Synset", function tests() {
		var synsetProm = new wordNet.Word("bank").getSynsets();
		it("retrieves a synset array for aspecific word", function test() {
			expect(synsetProm).to.eventually.be.instanceOf(Array);
		});
	});

	describe("Hypernyms", function tests() {
		it("get the hypernym of a word", async function test() {

			let result = await wordNet
			.fetchSynset("king.n.1")
			.then(async (synset) =>await synset.getHypernyms().then(hypernym=> hypernym));

			expect(result[0].lexdomain).to.equal('noun.person');
			expect(result[0].pos).to.equal('n');
			expect(result[0].definition).to.equal("a nation's ruler or head of state usually by hereditary right");
			expect(result[0].synsetid).to.equal(110648006);
			expect(JSON.stringify(result[0].words)).to.equal(`[{"lemma":"crowned head"},{"lemma":"monarch"},{"lemma":"sovereign"}]`);
			
		});
	});
});
