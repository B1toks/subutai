// carryover.test.mjs (copied unchanged from the independent review) checks
// that the R-14 hole is open unless EXPECT_FIXED is set. These rules close
// it, so test:rules runs it with this preload. Set here and not on the
// command line, which npm runs through cmd on Windows.
process.env.EXPECT_FIXED = '1';
