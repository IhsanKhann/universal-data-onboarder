import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Universal Data Onboarding Engine",
  description: "Streaming-safe, adapter-driven data import pipeline.",
  ignoreDeadLinks: true,
  base: process.env.BASE_URL || "/universal-data-onboarder/",
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Quickstart", link: "/quickstart" },
      { text: "Architecture", link: "/architecture" },
      { text: "GitHub", link: "https://github.com/IhsanKhann/universal-data-onboarder" },
    ],
    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "Quickstart", link: "/quickstart" },
          { text: "Architecture", link: "/architecture" },
          { text: "Deployment", link: "/deployment" },
        ],
      },
      {
        text: "Development",
        items: [
          { text: "Target Descriptor Guide", link: "/target-descriptor-guide" },
          { text: "Adapter Contract Tests", link: "/quickstart" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/IhsanKhann/universal-data-onboarder" },
    ],
    footer: {
      message: "Released under the MIT License.",
      copyright: `Copyright ${new Date().getFullYear()}`,
    },
  },
});
