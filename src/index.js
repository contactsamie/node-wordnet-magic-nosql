var util = require("util");
var Promise = require("bluebird");
var join = Promise.join;
var _ = require("underscore");
var fs = require("fs");
var path = require("path");

// String
if (!String.prototype.hasOwnProperty("repeat")) {
	String.prototype.repeat = function (num) {
		return new Array(num + 1).join(this);
	};
}

if (!String.prototype.hasOwnProperty("endsWith")) {
	String.prototype.endsWith = function (str) {
		var myRegExp = new RegExp(str + "$");
		return myRegExp.test(this);
	};
}

// Array
if (!Array.prototype.hasOwnProperty("pick")) {
	Array.prototype.pick = function (name) {
		return this.map(function (elem) {
			return elem[name];
		});
	};
}

if (!Array.prototype.hasOwnProperty("contains")) {
	Array.prototype.contains = function (elem) {
		for (var q = 0; q < this.length; q++) {
			if (elem == this[q]) {
				return true;
			}
		}
		return false;
	};
}
var input_pathx = "";
// WordNet Revealing Closure Pattern:
function loader(name) {
	loader.memo = loader.memo || {};
	if (loader.memo[name]) {
		return loader.memo[name];
	}
	return new Promise(function (resolve, reject) {
		var d = require(input_pathx + "/" + name.toLowerCase() + ".json");
		resolve(d);
	});
}
function makeWordNet(input_path, preload) {
	input_pathx = input_path;

	var wn = {};

	preload ? (wn.preload = preload) : (wn.preload = false);

	if (wn.preload === true) {
		wn.SAMPLES = loader("SAMPLES");
		wn.SEMLINKS = loader("SEMLINKS");
		wn.SEMLINKS.HYPERNYMS = loader("SEMLINKS.HYPERNYMS");
		wn.SEMLINKS.SISTERS = loader("SEMLINKS.SISTERS");
		wn.WORDSxSENSESxSYNSETSxLEXDOMAINS = loader(
			"WORDSxSENSESxSYNSETSxLEXDOMAINS"
		);
		wn.SYNSETSxLEXDOMAINS = loader("SYNSETSxLEXDOMAINS");
	}

	wn.MORPHY_SUBSTITUTIONS = {
		NOUN: [
			{ suffix: "s", ending: "" },
			{ suffix: "ses", ending: "s" },
			{ suffix: "ves", ending: "f" },
			{ suffix: "xes", ending: "x" },
			{ suffix: "zes", ending: "z" },
			{ suffix: "ches", ending: "ch" },
			{ suffix: "shes", ending: "sh" },
			{ suffix: "men", ending: "man" },
			{ suffix: "ies", ending: "y" },
		],
		VERB: [
			{ suffix: "s", ending: "" },
			{ suffix: "ies", ending: "y" },
			{ suffix: "es", ending: "e" },
			{ suffix: "es", ending: "" },
			{ suffix: "ed", ending: "e" },
			{ suffix: "ed", ending: "" },
			{ suffix: "ing", ending: "e" },
			{ suffix: "ing", ending: "" },
		],
		ADJECTIVE: [
			{ suffix: "er", ending: "" },
			{ suffix: "est", ending: "" },
			{ suffix: "er", ending: "e" },
			{ suffix: "est", ending: "e" },
		],
	};

	wn.morphy = function (input_str, pos, callback) {
		return wn.morphyPromise(input_str, pos).nodeify(callback);
	};

	wn.morphyPromise = function (input_str, pos) {
		if (!pos) {
			var arr = ["n", "v", "a", "r", "s"];
			var resArray = [];
			for (var i = 0; i <= 4; i++) {
				resArray.push(wn.morphyPromise(input_str, arr[i]));
			}
			return Promise.all(resArray).then(function (data) {
				var reducedArray = [];
				for (var i = 0; i < data.length; i++) {
					var current = data[i];
					reducedArray.push(current);
				}
				return _.flatten(reducedArray);
			});
		}

		var substitutions;
		switch (pos) {
			case "n":
				substitutions = _.clone(wn.MORPHY_SUBSTITUTIONS.NOUN);
				break;
			case "v":
				substitutions = _.clone(wn.MORPHY_SUBSTITUTIONS.VERB);
				break;
			case "a":
				substitutions = _.clone(wn.MORPHY_SUBSTITUTIONS.ADJECTIVE);
				break;
			default:
				substitutions = [];
		}

		if (!wn.DICTIONARY) {
			wn.DICTIONARY = loader("DICTIONARY");
		}

		if (!wn.EXCEPTIONS) {
			wn.EXCEPTIONS = loader("EXCEPTIONS");
		}

		var wordsPromise = Promise.join(
			wn.DICTIONARY,
			wn.EXCEPTIONS,
			function (dictionary, exceptions) {
				function rulesOfDetachment(word, substitutions) {
					var result = [];

					dictionary
						.filter(function (elem) {
							return elem.lemma === word;
						})
						.forEach(function (elem) {
							if (elem.pos === pos) {
								var obj = new wn.Word(elem.lemma);
								obj.part_of_speech = elem.pos;
								result.push(obj);
							}
						});

					for (var i = 0; i < substitutions.length; i++) {
						var suffix = substitutions[i].suffix;
						var new_ending = substitutions[i].ending;

						if (word.endsWith(suffix) === true) {
							var new_word =
								word.substring(0, word.length - suffix.length) + new_ending;
							substitutions.splice(i, 1);
							if (new_word.endsWith("e") && !word.endsWith("e")) {
								substitutions.push({ suffix: "e", ending: "" });
							}
							var recResult = rulesOfDetachment(new_word, substitutions);
							Array.isArray(recResult)
								? (result = result.concat(recResult))
								: result.push(recResult);
						}
					}
					return result;
				}

				var found_exceptions = [];
				var exception_morphs = exceptions.map(function (elem) {
					return elem.morph;
				});

				var index = exception_morphs.indexOf(input_str);
				while (index !== -1) {
					if (exceptions[index].pos === pos) {
						var base_word = new wn.Word(exceptions[index].lemma);
						base_word.part_of_speech = pos;
						found_exceptions.push(base_word);
					}

					index = exception_morphs.indexOf(input_str, index + 1);
				}

				if (found_exceptions.length > 0) {
					return found_exceptions;
				} else {
					if (pos === "n" && input_str.endsWith("ful")) {
						suffix = "ful";
						input_str = input_str.slice(0, input_str.length - suffix.length);
					} else {
						suffix = "";
					}
					return rulesOfDetachment(input_str, substitutions);
				}
			}
		);
		return wordsPromise;
	};

	wn.isVerb = function (str, callback) {
		var word = wn.morphyPromise(str);
		var res = word.then(function (data) {
			var posArray = data.pick("part_of_speech");
			return posArray.contains("v");
		});
		return res.nodeify(callback);
	};

	wn.isNoun = function (str, callback) {
		var word = wn.morphyPromise(str);
		var res = word.then(function (data) {
			var posArray = data.pick("part_of_speech");
			return posArray.contains("n");
		});
		return res.nodeify(callback);
	};

	wn.isAdjective = function (str, callback) {
		var word = wn.morphyPromise(str);
		var res = word.then(function (data) {
			var posArray = data.pick("part_of_speech");
			return posArray.contains("a") || posArray.contains("s");
		});
		return res.nodeify(callback);
	};

	wn.isAdverb = function (str, callback) {
		var word = wn.morphyPromise(str);
		var res = word.then(function (data) {
			var posArray = data.pick("part_of_speech");
			return posArray.contains("r");
		});
		return res.nodeify(callback);
	};

	wn.Word = function (str, pos) {
		this.lemma = str;
		if (pos) {
			this.part_of_speech = pos;
		}
	};

	wn.Word.prototype = {
		constructor: wn.Word,
		getSynsets: function (callback) {
			var self = this;
			var ret, query;

			self.part_of_speech = self.part_of_speech || null;

			function _findSynsetsArray(data) {
				switch (self.part_of_speech) {
					case null:
						if (!wn.preload) {
						} else {
							ret = wn.WORDSxSENSESxSYNSETSxLEXDOMAINS.then(function (d) {
								return d[data];
							});
						}
						break;
					default:
						if (!wn.preload) {
						} else {
							ret = wn.WORDSxSENSESxSYNSETSxLEXDOMAINS.then(function (d) {
								var candidateSet = d[data];
								var res = [];
								for (var i = 0; i < candidateSet.length; i++) {
									if (candidateSet[i].pos == self.part_of_speech) {
										res.push(candidateSet[i]);
									}
								}
								return res;
							});
						}
				}
				return ret;
			}

			function _formSynsetsArray(data) {
				var SynsetArray = [];
				for (var i = 0; i < data.length; i++) {
					var obj = _findSynsetDefFromId(data[i]);
					SynsetArray.push(obj);
				}
				return Promise.all(SynsetArray);
			}

			var promise = _findSynsetsArray(this.lemma)
				.then(_formSynsetsArray)
				.map(_appendLemmas)
				.map(function (item) {
					return new wn.Synset(item);
				});
			return promise.nodeify(callback);
		},
		getAntonyms: function (callback) {
			var self = this;
			self.part_of_speech = self.part_of_speech || null;
			var word = this.lemma;

			function _formAntonymsArray(synsetid) {
				return loader("_formAntonymsArray").then(function (tempData) {
					var finalResult = tempData[word];

					return finalResult;
				});
			}

			function _findSynsetsArray(word) {
				return _findWordId(word).then(_findSynsetsFromId);
			}

			function _findWordId(str) {
				var tttt = loader("_findWordId");
				return tttt.then(function (tempData) {
					var finalResult = tempData[str];
					return finalResult[0];
				});
			}

			function _findSynsetsFromId(data) {
				var query, ret;
				switch (self.part_of_speech) {
					case null:
						ret = loader("_findsynsetsfromid_all_parts_of_speech").then(
							function (tempData) {
								var finalResult = tempData[data.wordid];

								return finalResult.map(function (elem) {
									return elem.synsetid;
								});
							}
						);
						break;
					default:
						ret = loader("_findSynsetsFromId_one_parts_of_speech").then(
							function (tempData) {
								var finalResult = tempData[data.wordid]
									.filter((x) => {
										return self.part_of_speech === x.pos;
									})
									.map(function (elem) {
										return elem.synsetid;
									});

								return finalResult;
							}
						);
				}
				return ret;
			}

			function _formSynsetsArray(data) {
				var SynsetArray = [];
				for (var i = 0; i < data.length; i++) {
					var obj = _findSynsetDefFromId(data[i]);
					SynsetArray.push(obj);
				}
				return Promise.all(SynsetArray);
			}

			function _findSynsetDefFromId(data) {
				var ret;
				if (!wn.preload) {
				} else {
					ret = wn.SYNSETSxLEXDOMAINS.then(function (returnSet) {
						return returnSet[synsetid];
					});
				}
				return ret;
			}

			var promise = _findSynsetsArray(this.lemma).then(_formAntonymsArray);
			return promise.nodeify(callback);
		},
		getPolysemyCount: function (pos, callback) {
			this.part_of_speech = pos;
			var synsetArrayProm = this.getSynsets();
			synsetArrayProm = synsetArrayProm.then(function (array) {
				var polysemy_count = array.length;
				return polysemy_count;
			});
			return synsetArrayProm.nodeify(callback);
		},
	};

	wn.fetchSynset = async function (identifier, callback) {
		var ret;
		var inputs = identifier.split(".");
		if (!wn.preload) {
		} else {
			ret = wn.WORDSxSENSESxSYNSETSxLEXDOMAINS.then(function (d) {
				var search_lemma = inputs[0];
				var res;
				var candidateSet = d[search_lemma];
				for (var i = 0; i < candidateSet.length; i++) {
					if (
						candidateSet[i].pos === inputs[1] &&
						candidateSet[i].sensenum === parseInt(inputs[2], 10)
					) {
						res = candidateSet[i];
					}
				}

				return res;
			});
		}

		return ret
			.then(_appendLemmas)
			.then(function (data) {
				return new wn.Synset(data);
			})
			.nodeify(callback);
	};

	// Synset Class
	wn.Synset = function (obj) {
		this.synsetid = obj.synsetid;
		this.words = obj.words;
		this.definition = obj.definition;
		this.pos = obj.pos;
		this.lexdomain = obj.lexdomain;

		if (obj.hypernym) {
			this.hypernym = obj.hypernym;
		}

		if (obj.hyponym) {
			this.hyponym = obj.hyponym;
		}

		if (obj.holonymOf) {
			this.holonymOf = obj.holonymOf;
		}

		if (obj.domain_type) {
			this.domain_type = obj.domain_type;
		}

		if (obj.term_type) {
			this.term_type = obj.term_type;
		}
	};

	wn.Synset.prototype = {
		constructor: wn.Synset,
		//   fetchSynset: function(callback){
		// 	  var inputs = obj.split(".");

		// 	  var query = "SELECT s.synsetid, s.definition, s.pos, l.lexdomainname AS lexdomain FROM wordsXsensesXsynsets AS s LEFT JOIN lexdomains AS l ON l.lexdomainid = s.lexdomainid";
		// 	  query += "WHERE s.pos = $pos AND s.lemma = $lemma AND s.sensenum = $sensenum";

		// 	  var ret = db.eachAsync(query,{
		// 		   $lemma: inputs[0],
		// 		   $pos: inputs[1],
		// 		   $sensenum: inputs[2]
		// 		 });

		// 	  ret.then(function(data){
		// 		  this.synsetid = data.synsetid;
		// 		  this.definition = data.definition;
		// 		  this.pos = data.pos;
		// 		  this.lexdomain = data.lexdomain;

		// 		  callback
		// 	  });

		// 	  fetched = true;
		//   },
		getExamples: function (callback) {
			var promise = _findSamplesArray(this.synsetid).map(function (item) {
				return new wn.Example(item);
			});
			return promise.nodeify(callback);
		},
		getLemmas: function (callback) {
			var promise = _findLemmasArray(this.synsetid).map(function (item) {
				return new wn.Word(item.lemma);
			});
			return promise.nodeify(callback);
		},
		getHypernyms: function (callback) {
			var promise = _findHypernymsArray(this.synsetid)
				.map(_appendLemmas)
				.map(function (item) {
					return new wn.Synset(item);
				});
			return promise.nodeify(callback);
		},
		getHypernymsTree: function (callback) {
			function getHypernymFromId(input) {
				return _findHypernymsArray(input)
					.map(_appendLemmas)
					.map(function (item) {
						item.hypernym = getHypernymFromId(item.synsetid);
						return Promise.props(item);
					})
					.map(function (item) {
						var obj = new wn.Synset(item);
						return obj;
					});
			}
			var promise = getHypernymFromId(this.synsetid);
			return promise.nodeify(callback);
		},
		getHyponyms: function (callback) {
			var promise = _findHyponymsArray(this.synsetid)
				.map(_appendLemmas)
				.map(function (item) {
					return new wn.Synset(item);
				});
			return promise.nodeify(callback);
		},
		getHyponymsTree: function (callback) {
			function getHyponymsFromId(input) {
				return _findHyponymsArray(input)
					.map(_appendLemmas)
					.map(function (item) {
						item.hyponym = getHyponymsFromId(item.synsetid);
						return Promise.props(item);
					})
					.map(function (item) {
						var obj = new wn.Synset(item);
						return obj;
					});
			}
			var promise = getHyponymsFromId(this.synsetid);
			return promise.nodeify(callback);
		},
		getHolonyms: function (type, callback) {
			var promise = _findHolonymsArray(this.synsetid, type)
				.map(_appendLemmas)
				.map(function (item) {
					return new wn.Synset(item);
				});
			return promise.nodeify(callback);
		},
		getMeronyms: function (type, callback) {
			var promise = _findMeronymsArray(this.synsetid, type)
				.map(_appendLemmas)
				.map(function (item) {
					return new wn.Synset(item);
				});
			return promise.nodeify(callback);
		},
		getSisterTerms: function (callback) {
			var promise = _findSisterTermsArray(this.synsetid)
				.map(_appendLemmas)
				.map(function (item) {
					return new wn.Synset(item);
				});
			return promise.nodeify(callback);
		},
		causeOf: function (callback) {
			var promise = _findCauseOfArray(this.synsetid)
				.map(_appendLemmas)
				.map(function (item) {
					return new wn.Synset(item);
				});
			return promise.nodeify(callback);
		},
		getDomains: function (callback) {
			var classification;

			function _findDomainsArray(synsetid) {
				var arr;
				if (!wn.preload) {
				} else {
					arr = wn.SEMLINKS.then(function (data) {
						return data.filter(function (e) {
							return (
								e.synset1id === synsetid && [91, 93, 95].contains(e.linkid)
							);
						});
					});
				}

				return arr.map(function (data) {
					var obj = {};
					obj.synsetid = data.synset2id;

					switch (data.linkid) {
						case 91:
							classification = "topic";
							break;
						case 93:
							classification = "region";
							break;
						case 95:
							classification = "usage";
							break;
					}

					return _findSynsetDefFromId(obj);
				});
			}

			var promise = _findDomainsArray(this.synsetid)
				.map(_appendLemmas)
				.map(function (item) {
					item.domain_type = classification;
					return new wn.Synset(item);
				});
			return promise.nodeify(callback);
		},
		getDomainTerms: function (callback) {
			var classification;

			function _findDomainTermsArray(synsetid) {
				var arr;
				if (!wn.preload) {
				} else {
					arr = wn.SEMLINKS.then(function (data) {
						return data.filter(function (e) {
							return (
								e.synset2id === synsetid && [92, 94, 96].contains(e.linkid)
							);
						});
					});
				}

				return arr.map(function (data) {
					var obj = {};
					obj.synsetid = data.synset1id;
					switch (data.linkid) {
						case 92:
							classification = "topic";
							break;
						case 94:
							classification = "region";
							break;
						case 96:
							classification = "usage";
							break;
					}

					return _findSynsetDefFromId(obj);
				});
			}

			var promise = _findDomainTermsArray(this.synsetid)
				.map(_appendLemmas)
				.map(function (item) {
					item.term_type = classification;
					return new wn.Synset(item);
				});
			return promise.nodeify(callback);
		},
		toString: function () {
			return this.definition;
		},
	};

	// Example Class
	wn.Example = function (obj) {
		this.synsetid = obj.synsetid;
		this.sampleid = obj.sampleid;
		this.sample = obj.sample;
	};

	wn.Example.prototype = {
		constructor: wn.Example,
		toString: function () {
			return this.sample;
		},
	};

	wn.print = function (obj) {
		switch (obj.constructor) {
			case Array:
				for (var i = 0; i < obj.length; i++) {
					wn.print(obj[i]);
				}
				break;
			case wn.Synset:
				function getSynsetString(input, depth) {
					var current_depth = depth + 1;
					var words;
					if (Array.isArray(input.words)) {
						words = input.words.map(function (item) {
							return item.lemma;
						});
					} else {
						words = new Array(input.lemma);
					}
					var str = "S: (" + input.pos + ") ";
					str += words.join(", ");
					str += " (" + input.definition + ")";

					if (input.hypernym) {
						if (Array.isArray(input.hypernym)) {
							input.hypernym.forEach(function (elem) {
								var space = String(" ");
								var times = current_depth * 4;
								var spaces = space.repeat(times);
								str += "\n" + spaces + getSynsetString(elem, current_depth);
							});
						} else {
							str += "  " + getSynsetString(input.hypernym, current_depth);
						}
					}
					if (input.hyponym) {
						if (Array.isArray(input.hyponym)) {
							input.hyponym.forEach(function (elem) {
								var space = String(" ");
								var times = current_depth * 4;
								var spaces = space.repeat(times);
								str += "\n" + spaces + getSynsetString(elem, current_depth);
							});
						} else {
							str += "  " + getSynsetString(input.hyponym, current_depth);
						}
					}
					return str;
				}
				var synsetString = getSynsetString(obj, 0);
				console.log(synsetString);
				break;
			case wn.Word:
				console.log("L: " + obj.lemma);
				break;
			case wn.Example:
				console.log("E: " + obj.sample);
				break;
		}
	};

	function _findSisterTermsArray(synsetid) {
		var hypernymIdArray = _findHypernymsArray(synsetid);
		return hypernymIdArray.map(function (data) {
			var arr;
			if (!wn.preload) {
			} else {
				arr = wn.SEMLINKS.SISTERS.then(function (resultSet) {
					return resultSet[data.synsetid] || [];
				});
			}
			arr = arr
				.map(function (data) {
					var obj = {};
					obj.synsetid = data.synset1id;
					return _findSynsetDefFromId(obj);
				})
				.map(_appendLemmas);
			var ret = data;
			ret.hyponym = arr;
			return Promise.props(ret);
		});
	}

	function _findHyponymsArray(synsetid) {
		var arr;
		if (!wn.preload) {
		} else {
			arr = wn.SEMLINKS.filter(function (e) {
				return e.synset1id === synsetid && e.linkid === 1;
			});
		}

		return arr.map(function (data) {
			var obj = {};
			obj.synsetid = data.synset2id;
			return _findSynsetDefFromId(obj);
		});
	}

	function _findCauseOfArray(synsetid) {
		var arr;
		if (!wn.preload) {
		} else {
			arr = wn.SEMLINKS.filter(function (e) {
				return e.linkid === 23 && e.synset1id === synsetid;
			});
		}
		return arr.map(function (data) {
			var obj = {};
			obj.synsetid = data.synset2id;
			return _findSynsetDefFromId(obj);
		});
	}

	function _appendLemmas(data) {
		var promise = _findLemmasArray(data.synsetid).map(function (item) {
			return new wn.Word(item.lemma);
		});
		var ret = data;
		ret.words = promise;
		return Promise.props(ret);
	}

	function _findHolonymsArray(synsetid, type) {
		/*
		linkids are:
		part: 11
		member: 13
		substance: 15
		*/
		var ids;
		var linkid;
		var arr;

		if (type) {
			type = Array.isArray(type) ? type : new Array(type);
			ids = type.map(function (elem) {
				switch (elem) {
					case "part":
						return 11;
						break;
					case "member":
						return 13;
						break;
					case "substance":
						return 15;
						break;
				}
			});
			linkid = "IN (" + ids.join(",") + ")";
		} else {
			linkid = "IN (11,13,15)";
		}
		if (!wn.preload) {
		} else {
			arr = wn.SEMLINKS.then(function (data) {
				var ret = data.filter(function (e) {
					if (type) {
						return e.synset2id === synsetid && ids.contains(e.linkid);
					} else {
						return e.synset2id === synsetid;
					}
				});
				//console.log(ret);
				return ret;
			});
		}
		return arr.map(function (data) {
			var obj = {};
			obj.synsetid = data.synset1id;
			return _findSynsetDefFromId(obj);
		});
	}

	function _findMeronymsArray(synsetid, type) {
		/*
		linkids are:
		part: 12
		member: 14
		substance: 16
		*/
		var synID = synsetid;
		var linkid;
		if (type) {
			type = Array.isArray(type) ? type : new Array(type);
			var ids = type.map(function (elem) {
				switch (elem) {
					case "part":
						return 12;
					case "member":
						return 14;
					case "substance":
						return 16;
				}
			});
			linkid = "IN (" + ids.join(",") + ")";
		} else {
			linkid = "IN (12,14,16)";
		}

		var arr;
		if (!wn.preload) {
		} else {
			arr = wn.SEMLINKS.then(function (data) {
				var ret = data.filter(function (e) {
					return e.synset2id === synsetid && ids.contains(e.linkid);
				});
				return ret;
			});
		}
		return arr.map(function (data) {
			var obj = {};
			obj.synsetid = data.synset1id;
			return _findSynsetDefFromId(obj);
		});
	}

	function _findHypernymsArray(synsetid) {
		var arr;
		if (!wn.preload) {
		} else {
			arr = wn.SEMLINKS.HYPERNYMS.then(function (e) {
				return e[synsetid] || [];
			});
		}
		var ret = arr.map(function (d) {
			var obj = {};
			obj.synsetid = d.synset2id;
			return _findSynsetDefFromId(obj);
		});
		return ret;
	}

	function _findSamplesArray(synsetid) {
		if (!wn.preload) {
		} else {
			var ret = wn.SAMPLES.then(function (d) {
				return d[synsetid];
			});
			return ret;
		}
	}

	function _findLemmasArray(synsetid) {
		return new Promise(function (resolve, reject) {
			loader("_findLemmasArray").then(function (d) {
				var rrrr = d[synsetid];
				resolve(rrrr);
			});
		});
	}

	function _formSynsetsArray(data) {
		var SynsetArray = [];
		for (var i = 0; i < data.length; i++) {
			var obj = _findSynsetDefFromId(data[i]);
			SynsetArray.push(obj);
		}
		return Promise.all(SynsetArray);
	}

	function _findSynsetDefFromId(data) {
		var ret;
		if (!wn.preload) {
		} else {
			ret = wn.SYNSETSxLEXDOMAINS.then(function (returnSet) {
				return returnSet[data.synsetid];
			});
		}
		//ret.then(console.log)
		return ret;
	}

	return wn;
}

module.exports = makeWordNet;
