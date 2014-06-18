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
  // o(g).o(f) == g `after` f == g(f(x))
  function o(f) {
    var previous = null;
    if ("call" in this) {
      previous = this;
    }
    function of(x) {
      if (previous) {
        return previous.call(this, f.call(this, x));
      }
      return f.call(this, x);
    }
    of.o = o;
    return of;
  }

  // then(f).then(g) == o(g).o(f) == g(f(x))
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
    return then;
  }

  function map(f) {
    return function (xs) {
      var rs = [];
      var i = -1, l = xs.length;
      while (++i < l) rs[i] = f.call(this, xs[i]);
      return rs;
    }
  }

  function foldl(f) {
    return function (x) {
      return function (xs) {
        var i = 0, l = xs.length;
        while (i < l) x = f.call(this, x, xs[i++]);
        return x;
      }
    }
  }

  // ----------------------------------------------------------------

  //
  function Markov(depth) {
    depth = depth || 1;
    this.sep = ",";
    this.depth = depth;
    this.symbols = [""];
    this.symbolMap = {"":0};
    this.prePadding = Array(depth).join(this.sep).split(this.sep);
    this.postPadding = [""];
    // :: Map T (Map Index Count)
    this.chains = {};
    this.probabilities = null;
  }

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

  // train the model with a sequence of symbols
  var makeChains = o(forEachPrefixPair(addChain)).o(map(symbolToIndex)).o(map(addSymbol)).o(padInput);

  // train the model
  function train(symbols) {
    makeChains.call(this, symbols);
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

  // generate a random string with the model's probabilities
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

  function toJSON() {
    return JSON.stringify(this);
  }

  function fromJSON(str) {
    var M = new Markov();
    var obj = JSON.parse(str);
    for (var p in M) {
      if (obj[p]) {
        M[p] = obj[p];
      }
    }
    return M;
  }

  function score(symbols) {
    var len = symbols.length;
    var score = 0;
    var sumScores = forEachPrefixPair(function (pair) {
      var pfx = pair[0], sfx = pair[1];
      if (this.chains[pfx] && this.chains[pfx][sfx]) {
        score += this.chains[pfx][sfx] / this.chains[pfx]._sum;
      }
    });
    o(sumScores).o(map(symbolToIndex)).o(padInput).call(this, symbols);
    return score / len;
  }

  Markov.prototype.train = train;
  Markov.prototype.generate = generate;
  Markov.prototype.score = score;

  Markov.fromJSON = fromJSON;
  Markov.prototype.toJSON = toJSON;

  return Markov;
}))
