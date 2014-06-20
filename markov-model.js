(function (context, deps, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD
    define(deps, factory);
  } else if (typeof module !== "undefined" && module.exports) {
    // CommonJS
    module.exports = factory.call(context, deps.map(require));
  } else {
    // <script>
    context.Markov = factory();
  }
}(this, [], function () {
  // some functional stuff ------------------------------------------

  // then(f).then(g) == g(f(x))
  function then(f) {
    var previous = null;
    if ("call" in this) {
      previous = this;
    }
    function tf(x) {
      if (previous) {
        return f.call(this, previous.call(this, x));
      }
      return f.call(this, x);
    }
    tf.then = then;
    return tf;
  }

  // curried map that only passes 1 parameter to f
  function map(f) {
    return function (xs) {
      var rs = [];
      var i = -1, l = xs.length;
      while (++i < l) rs[i] = f.call(this, xs[i]);
      return rs;
    }
  }

  // the actual model functionalities -------------------------------

  // pad input with empty strings for start and end probabilities
  function padInput(xs) {
    return this.prePadding.concat(xs).concat(this.postPadding);
  }

  // map symbols to internal indexes
  function symbolToIndex(x) {
    return this.symbolMap[x];
  }

  // add symbol and map to internal indexes
  function addSymbol(x) {
    if (null == this.symbolMap[x]) {
      this.symbolMap[x] = this.symbols.push(x) - 1;
    }
    return x;
  }

  // add one count of `symbol follows prefix`
  function addChain(pair) {
    var prefix = pair[0];
    var symbol = pair[1];
    this.chains[prefix] = this.chains[prefix] || {_sum: 0};
    this.chains[prefix][symbol] = (this.chains[prefix][symbol] || 0) + 1;
    this.chains[prefix]._sum += 1;
    return pair;
  }

  // get i-th depth-sized slice of input
  function prefix(xs) {
    return function (i) {
      return xs.slice(i, i+this.depth).join(this.sep);
    }
  }

  // do f with all depth-sized prefixes and their following symbols
  function forEachPrefixPair(f) {
    return function (xs) {
      var i = 0;
      var l = xs.length - this.depth;
      var pref = prefix(xs);
      while (i < l) {
        f.call(this, [pref.call(this, i), xs[i + this.depth]]);
        i++;
      }
      return xs;
    }
  }

  // recalculate the random() limits for generation
  function updateProbabilities() {
    this.probabilities = {};
    for (var pfx in this.chains) {
      var upper = 0;
      var probs = [];
      for (var sfx in this.chains[pfx]) {
        upper = upper + (this.chains[pfx][sfx] / this.chains[pfx]._sum);
        probs.push([upper, sfx]);
      }
      this.probabilities[pfx] = probs;
    }
    return this;
  }

  // reset probabilities
  function resetProbabilities() {
    this.probabilities = null;
    return this;
  }

  // generate a random suffix for a given prefix
  function genSuffix(pfx) {
    var rand = Math.random();
    var i = 0;
    while (rand > this.probabilities[pfx][i][0]) {
      i++;
    }
    return this.probabilities[pfx][i][1];
  }

  // generate a random string of symbols with the model's probabilities
  function generate(minLength, maxLength) {
    if (this.probabilities == null) {
      updateProbabilities.call(this);
    }
    maxLength = maxLength || minLength;
    var string = [];
    var pfx = map(function (x) {
      return this.symbolMap[x];
    }).call(this, this.prePadding);
    var sfx = genSuffix.call(this, pfx.join(this.sep));
    var zCount = 0;
    while (string.length < maxLength && sfx != 0 || string.length < minLength) {
      if (sfx != 0) {
        string.push(this.symbols[sfx]);
        pfx.push(sfx);
        pfx.shift();
      } else {
        zCount += 1;
        if (zCount > 15) {
          break;
        }
      }
      sfx = genSuffix.call(this, pfx.join(this.sep));
    }
    return string;
  }

  // preparation for input to score and train
  var padToIndexes = then(padInput).then(map(symbolToIndex));

  // score in [0, 1] how well the input symbol list fits the model
  function score(symbols) {
    var len = symbols.length;
    var score = 0;
    var scoreAndSum = forEachPrefixPair(function (pair) {
      var pfx = pair[0], sfx = pair[1];
      if (this.chains[pfx] && this.chains[pfx][sfx]) {
        score += this.chains[pfx][sfx] / this.chains[pfx]._sum;
      }
    });
    padToIndexes.then(scoreAndSum).call(this, symbols);
    return score / len;
  }

  // Construct an instance for prefix length <depth>.
  // Optionally give a separator for the prefixes in chains.
  function Markov(depth) {
    depth = depth || 1;
    this.sep = ",";
    this.depth = depth;
    this.symbols = [""];
    this.symbolMap = {"":0};
    this.prePadding = Array(depth).join(this.sep).split(this.sep);
    this.postPadding = [""];
    this.chains = {};
    this.probabilities = null;
  }

  // train the model with a sequence of symbols
  Markov.prototype.train = then(map(addSymbol))
    .then(padToIndexes)
    .then(forEachPrefixPair(addChain))
    .then(resetProbabilities);
  Markov.prototype.generate = generate;
  Markov.prototype.score = score;
  Markov.prototype.toJSON = function toJSON() {
    return {
      depth: this.depth,
      symbols: this.symbols,
      chains: this.chains
    };
  };
  Markov.fromJSON = function fromJSON(str) {
    var obj = JSON.parse(str);
    var M = new Markov(obj.depth);
    M.symbols = obj.symbols;
    M.chains = obj.chains;
    return M;
  };

  return Markov;
}))
