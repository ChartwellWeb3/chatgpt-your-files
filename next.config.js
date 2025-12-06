/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {},
  },
  turbopack: {
    resolveAlias: {
      // similar idea to webpack's sharp$: false
      sharp$: "./src/empty-module.js",
      "onnxruntime-node$": "./src/empty-module.js",
    },
  },
};

module.exports = nextConfig;
