// AWS region 清單（CodePipeline 與 EC2 設定頁共用），掛在 window 供各設定頁取用
window.AWS_REGION_GROUPS = [
  {
    label: "Americas",
    regions: [
      { "name": "US East (Ohio)", "code": "us-east-2" },
      { "name": "US East (N. Virginia)", "code": "us-east-1" },
      { "name": "US West (N. California)", "code": "us-west-1" },
      { "name": "US West (Oregon)", "code": "us-west-2" },
      { "name": "Canada (Central)", "code": "ca-central-1" },
      { "name": "Canada West (Calgary)", "code": "ca-west-1" },
      { "name": "Mexico (Central)", "code": "mx-central-1" },
      { "name": "South America (São Paulo)", "code": "sa-east-1" }
    ]
  },
  {
    label: "Europe",
    regions: [
      { "name": "Europe (Frankfurt)", "code": "eu-central-1" },
      { "name": "Europe (Zurich)", "code": "eu-central-2" },
      { "name": "Europe (Ireland)", "code": "eu-west-1" },
      { "name": "Europe (London)", "code": "eu-west-2" },
      { "name": "Europe (Paris)", "code": "eu-west-3" },
      { "name": "Europe (Milan)", "code": "eu-south-1" },
      { "name": "Europe (Spain)", "code": "eu-south-2" },
      { "name": "Europe (Stockholm)", "code": "eu-north-1" }
    ]
  },
  {
    label: "Asia Pacific",
    regions: [
      { "name": "Asia Pacific (Hong Kong)", "code": "ap-east-1" },
      { "name": "Asia Pacific (Taipei)", "code": "ap-east-2" },
      { "name": "Asia Pacific (Tokyo)", "code": "ap-northeast-1" },
      { "name": "Asia Pacific (Seoul)", "code": "ap-northeast-2" },
      { "name": "Asia Pacific (Osaka)", "code": "ap-northeast-3" },
      { "name": "Asia Pacific (Mumbai)", "code": "ap-south-1" },
      { "name": "Asia Pacific (Hyderabad)", "code": "ap-south-2" },
      { "name": "Asia Pacific (Singapore)", "code": "ap-southeast-1" },
      { "name": "Asia Pacific (Sydney)", "code": "ap-southeast-2" },
      { "name": "Asia Pacific (Jakarta)", "code": "ap-southeast-3" },
      { "name": "Asia Pacific (Melbourne)", "code": "ap-southeast-4" },
      { "name": "Asia Pacific (Malaysia)", "code": "ap-southeast-5" },
      { "name": "Asia Pacific (Thailand)", "code": "ap-southeast-7" }
    ]
  },
  {
    label: "Middle East & Africa",
    regions: [
      { "name": "Africa (Cape Town)", "code": "af-south-1" },
      { "name": "Middle East (Bahrain)", "code": "me-south-1" },
      { "name": "Middle East (UAE)", "code": "me-central-1" },
      { "name": "Israel (Tel Aviv)", "code": "il-central-1" }
    ]
  },
  {
    label: "GovCloud",
    regions: [
      { "name": "AWS GovCloud (US-East)", "code": "us-gov-east-1" },
      { "name": "AWS GovCloud (US-West)", "code": "us-gov-west-1" }
    ]
  }
];
