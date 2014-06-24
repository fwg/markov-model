(function (context, deps, factory) {
  // You can use it with AMD/RequireJS.
  if (typeof define === 'function' && define.amd) {
    return define(deps, factory);
  }
  // You can use it in a CommonJS environment like node.js.
  if (typeof module !== "undefined" && module.exports) {
    return module.exports = factory.apply(context, deps.map(require));
  }
  // You can also just include it in your page with a `<script>` tag.
  context.Markov = factory();
}(this, [], function () {
  // Markov model class
  // ------------------
  //
  // This class provides a way to create a model of the probabilistic
  // properties of a sequence of symbols and generate a new sequence from
  // this model with the recorded probabilities. It has one parameter:
  // depth.
  //
  function Markov(depth) {
    // It works by taking depth-sized subsequences of the input as a prefix
    // and counting how often which symbol follows such a prefix.
    //
    depth = depth || 1;
    this.depth = depth;
    this.counts = {};
    //
    // It is agnostic to the type of the symbols, as it converts the input
    // sequence to indexes in a set of known symbols. You can replace any
    // symbol (except the `0` symbol) without breaking the model.
    //
    this.symbols = [""];
    this.separator = ",";
    this.symbolMap = {"":0};
    this.prePadding = Array(depth).join(",").split(",");
    this.postPadding = [""];
    //
    // It can generate a random sequence by converting the counts to
    // probabilities and taking each subsequence as a state in the generation
    // process, thereby producing a Markov chain.
    //
    this.probabilities = null;
  }

  // ### Training the model

  // Train the model with a sequence of symbols by
  // adding all the symbols to the set of known symbols,
  // padding the input with empty strings as starting symbols,
  // converting the symbols to indexes, and
  // counting all prefix-symbol pairs.
  Markov.prototype.train = compose([
    curry(map, addSymbol),
    padInput,
    curry(map, symbolToIndex),
    curry(forEachPrefixPair, countPair),
    resetProbabilities
  ]);

  // ### Generating a sequence

  // Generate a random sequence of symbols with the model's probabilities.
  // Will try to honour the `minLength` but cannot escape absorbing states
  // that only have the sequence end as their following state. It may produce
  // a sequence shorter than `minLength` but never a sequence longer than
  // `maxLength`.
  //
  // Works by using a `depth`-sized list of symbols that represents the current
  // state and shifting the randomly chosen symbol to the end of it until
  // either `maxLength` symbols were generated or the end state (symbol `0`)
  // was generated 15 times.
  Markov.prototype.generate = function generate(minLength, maxLength) {
    if (this.probabilities == null) {
      updateProbabilities.call(this);
    }
    maxLength = maxLength || minLength;
    var string = [];
    var pfx = map.call(this, symbolToIndex, this.prePadding);
    var sfx = genSuffix.call(this, pfx.join(this.separator));
    var zCount = 0;
    while (string.length < maxLength && sfx != 0 ||
           string.length < minLength) {
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
      sfx = genSuffix.call(this, pfx.join(this.separator));
    }
    return string;
  }

  // ### Scoring a sequence

  // Score a sequence on how well it matches the model's probabilities.
  // Produces a value between `0` and `1`.
  //
  // Works by mapping the sequence to indexes and summing the recorded counts
  // of the prefix-symbol occurrences scaled by their relative frequency.
  Markov.prototype.score = compose([
    function (symbols) {
      this._score = 0;
      this._scoreFactor = symbols.length;
      return symbols;
    },
    padInput,
    curry(map, symbolToIndex),
    curry(forEachPrefixPair, function (pair) {
      var pfx = pair[0], sfx = pair[1];
      if (this.counts[pfx] && this.counts[pfx][sfx]) {
        this._score += this.counts[pfx][sfx] / this.counts[pfx]._sum;
      }
    }),
    function () {
      return this._score / this._scoreFactor;
    }
  ]);

  // ### Transforming to and from JSON

  // You can just use `JSON.stringify` on a model. This object contains all
  // relevant information for the model to be reconstructed.
  Markov.prototype.toJSON = function toJSON() {
    return {
      depth: this.depth,
      symbols: this.symbols,
      counts: this.counts
    };
  };

  // Restores a model from a JSON string! If you used non-primitive symbols
  // that need special initialisation, you can just iterate over `.symbols` and
  // replace them.
  Markov.fromJSON = function fromJSON(str) {
    var obj = JSON.parse(str);
    var M = new Markov(obj.depth);
    map.call(M, addSymbol, obj.symbols);
    M.counts = obj.counts;
    return M;
  };

  // --------------------------------------------------------------------------
  // Pad input with empty strings for start and end probabilities.
  function padInput(xs) {
    return this.prePadding.concat(xs).concat(this.postPadding);
  }

  // Map symbols to internal indexes.
  function symbolToIndex(x) {
    return this.symbolMap[x];
  }

  // Add symbol and map to internal index.
  function addSymbol(x) {
    if (null == this.symbolMap[x]) {
      this.symbolMap[x] = this.symbols.push(x) - 1;
    }
    return x;
  }

  // Add one count of `symbol follows prefix`.
  function countPair(pair) {
    var prefix = pair[0];
    var symbol = pair[1];
    this.counts[prefix] = this.counts[prefix] || {_sum: 0};
    this.counts[prefix][symbol] = (this.counts[prefix][symbol] || 0) + 1;
    this.counts[prefix]._sum += 1;
    return pair;
  }

  // Get `i`-th `depth`-sized slice/prefix of a list `xs`.
  function prefix(xs, i) {
    return xs.slice(i, i + this.depth).join(this.separator);
  }

  // Do `f` on all `depth`-sized prefixes and their following symbols.
  function forEachPrefixPair(f, xs) {
    var i = 0;
    var l = xs.length - this.depth;
    var pref = curry(prefix, xs);
    while (i < l) {
      f.call(this, [pref.call(this, i), xs[i + this.depth]]);
      i++;
    }
    return xs;
  }

  // Training resets probabilities because they are only needed for generation.
  function resetProbabilities() {
    this.probabilities = null;
    return this;
  }

  // Recalculate the `random()` limits for generation. This produces a map of
  // prefixes to a list of probabilities each paired with a symbol.
  //
  // Each probability is the sum of the previous probabilities and the
  // probability of the current symbol so that the values in the list only
  // increase.
  function updateProbabilities() {
    this.probabilities = {};
    for (var pfx in this.counts) {
      var upper = 0;
      var probs = [];
      for (var sfx in this.counts[pfx]) {
        upper = upper + (this.counts[pfx][sfx] / this.counts[pfx]._sum);
        probs.push([upper, sfx]);
      }
      this.probabilities[pfx] = probs;
    }
    return this;
  }

  // Generate a random suffix for a given prefix. Uses the fact that the
  // probabilities are only increasing to quickly find the symbol
  // corresponding to the random value.
  function genSuffix(pfx) {
    var rand = Math.random();
    var i = 0;

    while (this.probabilities[pfx][i] &&
           rand > this.probabilities[pfx][i][0]) {
      i++;
    }
    return this.probabilities[pfx][i][1];
  }

  // Some functional helpers
  //
  // --------------------------------------------------------------------------

  // Compose functions such that
  //
  //     compose([f, g, h])(x) == h(g(f(x)))
  function compose(fns) {
    return function composed(x) {
      var i = -1;
      var l = fns.length;
      while (++i < l) x = fns[i].call(this, x);
      return x;
    }
  }

  // Curry a function `f` with an argument `a`. Only works for functions with
  // at most four parameters.
  function curry(f, a) {
    return function curried(b, c, d) {
      return f.call(this, a, b, c, d);
    }
  }

  // `map` that only passes the element to `f`.
  function map(f, xs) {
    var rs = [];
    var i = -1, l = xs.length;
    while (++i < l) rs[i] = f.call(this, xs[i]);
    return rs;
  }

  return Markov;
}));
