// Study segments for the CCNA 200-301 Official Cert Guide Library (2nd edition, Volumes 1 & 2).
// Page numbers are the PRINTED page numbers in each volume. "hours" is a rough estimate for
// reading + notes + quiz review; subnetting chapters include extra practice time.
// Chapter/section titles are listed for reference only; all notes and questions on this site are original.

import { NOTES } from './notes.js'
import { OBJECTIVES } from './objectives.js'

const RAW_PARTS = [
  {
    "id": "v1-p1",
    "volume": 1,
    "title": "Part I: Introduction to Networking",
    "milestone": "Explain the TCP/IP layers and Ethernet framing without notes.",
    "chapters": [
      {
        "id": "v1-01",
        "volume": 1,
        "number": 1,
        "title": "Introduction to TCP/IP Networking",
        "pages": [
          16,
          35
        ],
        "sections": [
          {
            "title": "Perspectives on Networking",
            "page": 18
          },
          {
            "title": "TCP/IP Networking Model",
            "page": 19
          },
          {
            "title": "TCP/IP Data-Link and Physical Layers",
            "page": 29
          },
          {
            "title": "Data Encapsulation Terminology",
            "page": 31
          },
          {
            "title": "Chapter Review",
            "page": 34
          }
        ],
        "hours": 3
      },
      {
        "id": "v1-02",
        "volume": 1,
        "number": 2,
        "title": "Fundamentals of Ethernet LANs",
        "pages": [
          36,
          61
        ],
        "sections": [
          {
            "title": "An Overview of LANs",
            "page": 38
          },
          {
            "title": "Building Physical Ethernet LANs with UTP",
            "page": 43
          },
          {
            "title": "Building Physical Ethernet LANs with Fiber",
            "page": 50
          },
          {
            "title": "Sending Data in Ethernet Networks",
            "page": 53
          },
          {
            "title": "Chapter Review",
            "page": 60
          }
        ],
        "hours": 4
      },
      {
        "id": "v1-03",
        "volume": 1,
        "number": 3,
        "title": "Fundamentals of WANs and IP Routing",
        "pages": [
          62,
          83
        ],
        "sections": [
          {
            "title": "Wide-Area Networks",
            "page": 64
          },
          {
            "title": "IP Routing",
            "page": 71
          },
          {
            "title": "Other Network Layer Features",
            "page": 79
          },
          {
            "title": "Chapter Review",
            "page": 82
          }
        ],
        "hours": 4
      }
    ]
  },
  {
    "id": "v1-p2",
    "volume": 1,
    "title": "Part II: Implementing Ethernet LANs",
    "milestone": "Configure a switch from scratch: passwords, SSH, management IP, interface settings.",
    "chapters": [
      {
        "id": "v1-04",
        "volume": 1,
        "number": 4,
        "title": "Using the Command-Line Interface",
        "pages": [
          88,
          111
        ],
        "sections": [
          {
            "title": "Accessing the Cisco Catalyst Switch CLI",
            "page": 90
          },
          {
            "title": "Configuring Cisco IOS Software",
            "page": 103
          },
          {
            "title": "Chapter Review",
            "page": 109
          }
        ],
        "hours": 4
      },
      {
        "id": "v1-05",
        "volume": 1,
        "number": 5,
        "title": "Analyzing Ethernet LAN Switching",
        "pages": [
          112,
          131
        ],
        "sections": [
          {
            "title": "LAN Switching Concepts",
            "page": 114
          },
          {
            "title": "Verifying and Analyzing Ethernet Switching",
            "page": 121
          },
          {
            "title": "Chapter Review",
            "page": 128
          }
        ],
        "hours": 3
      },
      {
        "id": "v1-06",
        "volume": 1,
        "number": 6,
        "title": "Configuring Basic Switch Management",
        "pages": [
          132,
          157
        ],
        "sections": [
          {
            "title": "Securing the Switch CLI",
            "page": 134
          },
          {
            "title": "Enabling IPv4 for Remote Access",
            "page": 146
          },
          {
            "title": "Miscellaneous Settings Useful in the Lab",
            "page": 151
          },
          {
            "title": "Chapter Review",
            "page": 153
          }
        ],
        "hours": 4
      },
      {
        "id": "v1-07",
        "volume": 1,
        "number": 7,
        "title": "Configuring and Verifying Switch Interfaces",
        "pages": [
          158,
          183
        ],
        "sections": [
          {
            "title": "Configuring Switch Interface Speed and Duplex",
            "page": 161
          },
          {
            "title": "Managing Switch Interface Configuration",
            "page": 172
          },
          {
            "title": "Analyzing Switch Interface Status and Statistics",
            "page": 176
          },
          {
            "title": "Chapter Review",
            "page": 180
          }
        ],
        "hours": 4
      }
    ]
  },
  {
    "id": "v1-p3",
    "volume": 1,
    "title": "Part III: Implementing VLANs and STP",
    "milestone": "Build a multi-switch lab with VLANs, trunks, Rapid PVST+ root tuning and an LACP EtherChannel.",
    "chapters": [
      {
        "id": "v1-08",
        "volume": 1,
        "number": 8,
        "title": "Implementing Ethernet Virtual LANs",
        "pages": [
          188,
          221
        ],
        "sections": [
          {
            "title": "Virtual LAN Concepts",
            "page": 191
          },
          {
            "title": "VLAN and VLAN Trunking Configuration and Verification",
            "page": 197
          },
          {
            "title": "Chapter Review",
            "page": 218
          }
        ],
        "hours": 5
      },
      {
        "id": "v1-09",
        "volume": 1,
        "number": 9,
        "title": "Spanning Tree Protocol Concepts",
        "pages": [
          222,
          255
        ],
        "sections": [
          {
            "title": "STP and RSTP Basics",
            "page": 224
          },
          {
            "title": "Details Specific to STP (and Not RSTP)",
            "page": 236
          },
          {
            "title": "Rapid STP Concepts",
            "page": 239
          },
          {
            "title": "Optional STP Features",
            "page": 246
          },
          {
            "title": "Chapter Review",
            "page": 254
          }
        ],
        "hours": 5
      },
      {
        "id": "v1-10",
        "volume": 1,
        "number": 10,
        "title": "RSTP and EtherChannel Configuration",
        "pages": [
          256,
          295
        ],
        "sections": [
          {
            "title": "Understanding RSTP Through Configuration",
            "page": 259
          },
          {
            "title": "Identifying Optional STP Features",
            "page": 269
          },
          {
            "title": "BPDU Filter",
            "page": 274
          },
          {
            "title": "Root Guard",
            "page": 278
          },
          {
            "title": "Loop Guard",
            "page": 279
          },
          {
            "title": "Configuring Layer 2 EtherChannel",
            "page": 281
          },
          {
            "title": "Chapter Review",
            "page": 291
          }
        ],
        "hours": 6
      }
    ]
  },
  {
    "id": "v1-p4",
    "volume": 1,
    "title": "Part IV: IPv4 Addressing",
    "milestone": "Solve any subnet ID / broadcast / range problem in under 15 seconds.",
    "chapters": [
      {
        "id": "v1-11",
        "volume": 1,
        "number": 11,
        "title": "Perspectives on IPv4 Subnetting",
        "pages": [
          300,
          323
        ],
        "sections": [
          {
            "title": "Introduction to Subnetting",
            "page": 302
          },
          {
            "title": "Analyze Subnetting and Addressing Needs",
            "page": 304
          },
          {
            "title": "Make Design Choices",
            "page": 311
          },
          {
            "title": "Plan the Implementation",
            "page": 320
          },
          {
            "title": "Chapter Review",
            "page": 322
          }
        ],
        "hours": 6
      },
      {
        "id": "v1-12",
        "volume": 1,
        "number": 12,
        "title": "Analyzing Classful IPv4 Networks",
        "pages": [
          324,
          337
        ],
        "sections": [
          {
            "title": "Classful Network Concepts",
            "page": 325
          },
          {
            "title": "Practice with Classful Networks",
            "page": 334
          },
          {
            "title": "Chapter Review",
            "page": 335
          }
        ],
        "hours": 4
      },
      {
        "id": "v1-13",
        "volume": 1,
        "number": 13,
        "title": "Analyzing Subnet Masks",
        "pages": [
          338,
          355
        ],
        "sections": [
          {
            "title": "Subnet Mask Conversion",
            "page": 340
          },
          {
            "title": "Identifying Subnet Design Choices Using Masks",
            "page": 345
          },
          {
            "title": "Chapter Review",
            "page": 352
          }
        ],
        "hours": 5
      },
      {
        "id": "v1-14",
        "volume": 1,
        "number": 14,
        "title": "Analyzing Existing Subnets",
        "pages": [
          356,
          377
        ],
        "sections": [
          {
            "title": "Defining a Subnet",
            "page": 358
          },
          {
            "title": "Analyzing Existing Subnets: Binary",
            "page": 362
          },
          {
            "title": "Analyzing Existing Subnets: Decimal",
            "page": 367
          },
          {
            "title": "Practice Analyzing Existing Subnets",
            "page": 373
          },
          {
            "title": "Chapter Review",
            "page": 374
          }
        ],
        "hours": 6
      },
      {
        "id": "v1-15",
        "volume": 1,
        "number": 15,
        "title": "Subnet Design",
        "pages": [
          378,
          401
        ],
        "sections": [
          {
            "title": "Choosing the Mask(s) to Meet Requirements",
            "page": 380
          },
          {
            "title": "Finding All Subnet IDs",
            "page": 386
          },
          {
            "title": "Finding All Subnets with Exactly 8 Subnet Bits",
            "page": 393
          },
          {
            "title": "Finding All Subnets with More Than 8 Subnet Bits",
            "page": 393
          },
          {
            "title": "Practice Finding All Subnet IDs",
            "page": 396
          },
          {
            "title": "Chapter Review",
            "page": 396
          }
        ],
        "hours": 6
      }
    ]
  },
  {
    "id": "v1-p5",
    "volume": 1,
    "title": "Part V: IPv4 Routing",
    "milestone": "Route between VLANs and between routers with static routes; troubleshoot with ping and traceroute.",
    "chapters": [
      {
        "id": "v1-16",
        "volume": 1,
        "number": 16,
        "title": "Operating Cisco Routers",
        "pages": [
          406,
          425
        ],
        "sections": [
          {
            "title": "Installing Cisco Routers",
            "page": 407
          },
          {
            "title": "Enabling IPv4 Support on Cisco Router Interfaces",
            "page": 413
          },
          {
            "title": "Chapter Review",
            "page": 423
          }
        ],
        "hours": 3
      },
      {
        "id": "v1-17",
        "volume": 1,
        "number": 17,
        "title": "Configuring IPv4 Addresses and Static Routes",
        "pages": [
          426,
          453
        ],
        "sections": [
          {
            "title": "IP Routing",
            "page": 428
          },
          {
            "title": "Configuring IP Addresses and Connected Routes",
            "page": 435
          },
          {
            "title": "Configuring Static Routes",
            "page": 440
          },
          {
            "title": "Static Default Routes",
            "page": 443
          },
          {
            "title": "Static Host Routes",
            "page": 445
          },
          {
            "title": "Floating Static Routes",
            "page": 447
          },
          {
            "title": "Troubleshooting Static Routes",
            "page": 448
          },
          {
            "title": "Chapter Review",
            "page": 450
          }
        ],
        "hours": 4
      },
      {
        "id": "v1-18",
        "volume": 1,
        "number": 18,
        "title": "IP Routing in the LAN",
        "pages": [
          454,
          485
        ],
        "sections": [
          {
            "title": "VLAN Routing with Router 802.1Q Trunks",
            "page": 457
          },
          {
            "title": "VLAN Routing with Layer 3 Switch SVIs",
            "page": 464
          },
          {
            "title": "VLAN Routing with Layer 3 Switch Routed Ports",
            "page": 469
          },
          {
            "title": "VLAN Routing on a Router’s LAN Switch Ports",
            "page": 477
          },
          {
            "title": "Chapter Review",
            "page": 482
          }
        ],
        "hours": 5
      },
      {
        "id": "v1-19",
        "volume": 1,
        "number": 19,
        "title": "IP Addressing on Hosts",
        "pages": [
          486,
          511
        ],
        "sections": [
          {
            "title": "Dynamic Host Configuration Protocol",
            "page": 488
          },
          {
            "title": "Identifying Host IPv4 Settings",
            "page": 497
          },
          {
            "title": "Chapter Review",
            "page": 510
          }
        ],
        "hours": 4
      },
      {
        "id": "v1-20",
        "volume": 1,
        "number": 20,
        "title": "Troubleshooting IPv4 Routing",
        "pages": [
          512,
          533
        ],
        "sections": [
          {
            "title": "Problem Isolation Using the ping Command",
            "page": 513
          },
          {
            "title": "Problem Isolation Using the traceroute Command",
            "page": 524
          },
          {
            "title": "Telnet and SSH",
            "page": 527
          },
          {
            "title": "Chapter Review",
            "page": 530
          }
        ],
        "hours": 4
      }
    ]
  },
  {
    "id": "v1-p6",
    "volume": 1,
    "title": "Part VI: OSPF",
    "milestone": "Bring up single-area OSPFv2, control the DR, and fix a neighbor that will not form.",
    "chapters": [
      {
        "id": "v1-21",
        "volume": 1,
        "number": 21,
        "title": "Understanding OSPF Concepts",
        "pages": [
          538,
          561
        ],
        "sections": [
          {
            "title": "Comparing Dynamic Routing Protocol Features",
            "page": 540
          },
          {
            "title": "OSPF Concepts and Operation",
            "page": 546
          },
          {
            "title": "OSPF Areas and LSAs",
            "page": 555
          },
          {
            "title": "Chapter Review",
            "page": 560
          }
        ],
        "hours": 4
      },
      {
        "id": "v1-22",
        "volume": 1,
        "number": 22,
        "title": "Implementing Basic OSPF Features",
        "pages": [
          562,
          583
        ],
        "sections": [
          {
            "title": "Implementing OSPFv2 Using network Commands",
            "page": 564
          },
          {
            "title": "Implementing OSPFv2 Using Interface Subcommands",
            "page": 576
          },
          {
            "title": "Chapter Review",
            "page": 580
          }
        ],
        "hours": 4
      },
      {
        "id": "v1-23",
        "volume": 1,
        "number": 23,
        "title": "Implementing Optional OSPF Features",
        "pages": [
          584,
          607
        ],
        "sections": [
          {
            "title": "OSPF Network Types",
            "page": 586
          },
          {
            "title": "Additional Optional OSPFv2 Features",
            "page": 594
          },
          {
            "title": "Chapter Review",
            "page": 604
          }
        ],
        "hours": 4
      },
      {
        "id": "v1-24",
        "volume": 1,
        "number": 24,
        "title": "OSPF Neighbors and Route Selection",
        "pages": [
          608,
          633
        ],
        "sections": [
          {
            "title": "OSPF Neighbor Relationships",
            "page": 611
          },
          {
            "title": "Route Selection",
            "page": 621
          },
          {
            "title": "Chapter Review",
            "page": 630
          }
        ],
        "hours": 4
      }
    ]
  },
  {
    "id": "v1-p7",
    "volume": 1,
    "title": "Part VII: IP Version 6",
    "milestone": "Abbreviate, subnet and configure IPv6 addresses and static routes.",
    "chapters": [
      {
        "id": "v1-25",
        "volume": 1,
        "number": 25,
        "title": "Fundamentals of IP Version 6",
        "pages": [
          638,
          653
        ],
        "sections": [
          {
            "title": "Introduction to IPv6",
            "page": 640
          },
          {
            "title": "IPv6 Addressing Formats and Conventions",
            "page": 646
          },
          {
            "title": "Chapter Review",
            "page": 652
          }
        ],
        "hours": 3
      },
      {
        "id": "v1-26",
        "volume": 1,
        "number": 26,
        "title": "IPv6 Addressing and Subnetting",
        "pages": [
          654,
          667
        ],
        "sections": [
          {
            "title": "Global Unicast Addressing Concepts",
            "page": 655
          },
          {
            "title": "Unique Local Unicast Addresses",
            "page": 664
          },
          {
            "title": "Chapter Review",
            "page": 667
          }
        ],
        "hours": 2
      },
      {
        "id": "v1-27",
        "volume": 1,
        "number": 27,
        "title": "Implementing IPv6 Addressing on Routers",
        "pages": [
          668,
          695
        ],
        "sections": [
          {
            "title": "Implementing Unicast IPv6 Addresses on Routers",
            "page": 670
          },
          {
            "title": "Special Addresses Used by Routers",
            "page": 680
          },
          {
            "title": "Chapter Review",
            "page": 691
          }
        ],
        "hours": 4
      },
      {
        "id": "v1-28",
        "volume": 1,
        "number": 28,
        "title": "Implementing IPv6 Addressing on Hosts",
        "pages": [
          696,
          721
        ],
        "sections": [
          {
            "title": "The Neighbor Discovery Protocol",
            "page": 698
          },
          {
            "title": "Dynamic Configuration of Host IPv6 Settings",
            "page": 706
          },
          {
            "title": "Chapter Review",
            "page": 719
          }
        ],
        "hours": 4
      },
      {
        "id": "v1-29",
        "volume": 1,
        "number": 29,
        "title": "Implementing IPv6 Routing",
        "pages": [
          722,
          745
        ],
        "sections": [
          {
            "title": "Connected and Local IPv6 Routes",
            "page": 724
          },
          {
            "title": "Static IPv6 Network Routes",
            "page": 728
          },
          {
            "title": "Static Default, Host, and Floating Static IPv6 Routes",
            "page": 735
          },
          {
            "title": "Troubleshooting Static IPv6 Routes",
            "page": 741
          },
          {
            "title": "Chapter Review",
            "page": 744
          }
        ],
        "hours": 4
      }
    ]
  },
  {
    "id": "v1-p8",
    "volume": 1,
    "title": "Part VIII: Exam Updates",
    "milestone": "Check the companion site for updated content.",
    "chapters": [
      {
        "id": "v1-30",
        "volume": 1,
        "number": 30,
        "title": "Volume 1 (2nd ed.) Exam Updates",
        "pages": [
          750,
          756
        ],
        "sections": [
          {
            "title": "The Purpose of This Chapter",
            "page": 750
          },
          {
            "title": "News about the Next CCNA Exam Release",
            "page": 754
          },
          {
            "title": "Updated Technical Content",
            "page": 754
          }
        ],
        "hours": 1
      }
    ]
  },
  {
    "id": "v2-p1",
    "volume": 2,
    "title": "Part I: Wireless LANs",
    "milestone": "Compare WLAN architectures and build a WPA2-PSK WLAN on a WLC.",
    "chapters": [
      {
        "id": "v2-01",
        "volume": 2,
        "number": 1,
        "title": "Fundamentals of Wireless Networks",
        "pages": [
          4,
          21
        ],
        "sections": [
          {
            "title": "Comparing Wired and Wireless Networks",
            "page": 6
          },
          {
            "title": "Other Wireless Topologies",
            "page": 14
          },
          {
            "title": "Wireless Bands and Channels",
            "page": 17
          },
          {
            "title": "Chapter Review",
            "page": 20
          }
        ],
        "hours": 3
      },
      {
        "id": "v2-02",
        "volume": 2,
        "number": 2,
        "title": "Analyzing Cisco Wireless Architectures",
        "pages": [
          22,
          39
        ],
        "sections": [
          {
            "title": "Autonomous AP Architecture",
            "page": 24
          },
          {
            "title": "Cloud-based AP Architecture",
            "page": 26
          },
          {
            "title": "Split-MAC Architectures",
            "page": 28
          },
          {
            "title": "Comparing Cisco Wireless LAN Controller Deployments",
            "page": 32
          },
          {
            "title": "Chapter Review",
            "page": 37
          }
        ],
        "hours": 3
      },
      {
        "id": "v2-03",
        "volume": 2,
        "number": 3,
        "title": "Securing Wireless Networks",
        "pages": [
          40,
          55
        ],
        "sections": [
          {
            "title": "Anatomy of a Secure Connection",
            "page": 42
          },
          {
            "title": "Wireless Client Authentication Methods",
            "page": 46
          },
          {
            "title": "Wireless Privacy and Integrity Methods",
            "page": 50
          },
          {
            "title": "WPA, WPA2, and WPA3",
            "page": 51
          },
          {
            "title": "Chapter Review",
            "page": 53
          }
        ],
        "hours": 3
      },
      {
        "id": "v2-04",
        "volume": 2,
        "number": 4,
        "title": "Building a Wireless LAN",
        "pages": [
          56,
          87
        ],
        "sections": [
          {
            "title": "Connecting a Cisco AP",
            "page": 58
          },
          {
            "title": "Accessing a Cisco WLC",
            "page": 59
          },
          {
            "title": "Connecting a Cisco WLC",
            "page": 63
          },
          {
            "title": "Configuring a WLAN",
            "page": 65
          },
          {
            "title": "Chapter Review",
            "page": 87
          }
        ],
        "hours": 5
      }
    ]
  },
  {
    "id": "v2-p2",
    "volume": 2,
    "title": "Part II: IP Access Control Lists",
    "milestone": "Write and place standard and extended ACLs that match exactly what you intend.",
    "chapters": [
      {
        "id": "v2-05",
        "volume": 2,
        "number": 5,
        "title": "Introduction to TCP/IP Transport and Applications",
        "pages": [
          92,
          113
        ],
        "sections": [
          {
            "title": "TCP/IP Layer 4 Protocols: TCP and UDP",
            "page": 94
          },
          {
            "title": "TCP/IP Applications",
            "page": 104
          },
          {
            "title": "Chapter Review",
            "page": 112
          }
        ],
        "hours": 4
      },
      {
        "id": "v2-06",
        "volume": 2,
        "number": 6,
        "title": "Basic IPv4 Access Control Lists",
        "pages": [
          114,
          135
        ],
        "sections": [
          {
            "title": "IPv4 Access Control List Basics",
            "page": 116
          },
          {
            "title": "Standard Numbered IPv4 ACLs",
            "page": 119
          },
          {
            "title": "Chapter Review",
            "page": 133
          }
        ],
        "hours": 4
      },
      {
        "id": "v2-07",
        "volume": 2,
        "number": 7,
        "title": "Named and Extended IP ACLs",
        "pages": [
          136,
          159
        ],
        "sections": [
          {
            "title": "Named ACLs and ACL Editing",
            "page": 138
          },
          {
            "title": "Extended IP Access Control Lists",
            "page": 144
          },
          {
            "title": "Chapter Review",
            "page": 157
          }
        ],
        "hours": 4
      },
      {
        "id": "v2-08",
        "volume": 2,
        "number": 8,
        "title": "Applied IP ACLs",
        "pages": [
          160,
          179
        ],
        "sections": [
          {
            "title": "ACLs and Network Infrastructure Protocols",
            "page": 162
          },
          {
            "title": "Comparing ACLs in IOS and IOS XE",
            "page": 173
          },
          {
            "title": "Chapter Review",
            "page": 177
          }
        ],
        "hours": 3
      }
    ]
  },
  {
    "id": "v2-p3",
    "volume": 2,
    "title": "Part III: Security Services",
    "milestone": "Harden device access and configure port security, DHCP snooping and DAI.",
    "chapters": [
      {
        "id": "v2-09",
        "volume": 2,
        "number": 9,
        "title": "Security Architectures",
        "pages": [
          184,
          201
        ],
        "sections": [
          {
            "title": "Security Terminology",
            "page": 186
          },
          {
            "title": "Common Security Threats",
            "page": 188
          },
          {
            "title": "Controlling and Monitoring User Access",
            "page": 198
          },
          {
            "title": "Developing a Security Program to Educate Users",
            "page": 200
          },
          {
            "title": "Chapter Review",
            "page": 201
          }
        ],
        "hours": 3
      },
      {
        "id": "v2-10",
        "volume": 2,
        "number": 10,
        "title": "Securing Network Devices",
        "pages": [
          202,
          221
        ],
        "sections": [
          {
            "title": "Securing IOS Passwords",
            "page": 204
          },
          {
            "title": "Firewalls and Intrusion Prevention Systems",
            "page": 211
          },
          {
            "title": "Chapter Review",
            "page": 219
          }
        ],
        "hours": 3
      },
      {
        "id": "v2-11",
        "volume": 2,
        "number": 11,
        "title": "Implementing Switch Port Security",
        "pages": [
          222,
          237
        ],
        "sections": [
          {
            "title": "Port Security Concepts and Configuration",
            "page": 224
          },
          {
            "title": "Port Security Violation Modes",
            "page": 230
          },
          {
            "title": "Chapter Review",
            "page": 235
          }
        ],
        "hours": 3
      },
      {
        "id": "v2-12",
        "volume": 2,
        "number": 12,
        "title": "DHCP Snooping and ARP Inspection",
        "pages": [
          238,
          263
        ],
        "sections": [
          {
            "title": "DHCP Snooping",
            "page": 240
          },
          {
            "title": "Dynamic ARP Inspection",
            "page": 250
          },
          {
            "title": "Dynamic ARP Inspection Configuration",
            "page": 254
          },
          {
            "title": "Chapter Review",
            "page": 260
          }
        ],
        "hours": 4
      }
    ]
  },
  {
    "id": "v2-p4",
    "volume": 2,
    "title": "Part IV: IP Services",
    "milestone": "Configure NAT/PAT, NTP, syslog, CDP/LLDP; explain QoS, FHRP and SNMP.",
    "chapters": [
      {
        "id": "v2-13",
        "volume": 2,
        "number": 13,
        "title": "Device Management Protocols",
        "pages": [
          268,
          297
        ],
        "sections": [
          {
            "title": "System Message Logging (Syslog)",
            "page": 270
          },
          {
            "title": "Network Time Protocol (NTP)",
            "page": 277
          },
          {
            "title": "Analyzing Topology Using CDP and LLDP",
            "page": 283
          },
          {
            "title": "Chapter Review",
            "page": 293
          }
        ],
        "hours": 5
      },
      {
        "id": "v2-14",
        "volume": 2,
        "number": 14,
        "title": "Network Address Translation",
        "pages": [
          298,
          321
        ],
        "sections": [
          {
            "title": "Network Address Translation Concepts",
            "page": 300
          },
          {
            "title": "NAT Configuration and Troubleshooting",
            "page": 307
          },
          {
            "title": "Chapter Review",
            "page": 318
          }
        ],
        "hours": 4
      },
      {
        "id": "v2-15",
        "volume": 2,
        "number": 15,
        "title": "Quality of Service (QoS)",
        "pages": [
          322,
          349
        ],
        "sections": [
          {
            "title": "Introduction to QoS",
            "page": 324
          },
          {
            "title": "Classification and Marking",
            "page": 329
          },
          {
            "title": "Queuing",
            "page": 337
          },
          {
            "title": "Shaping and Policing",
            "page": 341
          },
          {
            "title": "Shaping",
            "page": 344
          },
          {
            "title": "Congestion Avoidance",
            "page": 346
          },
          {
            "title": "Chapter Review",
            "page": 348
          }
        ],
        "hours": 4
      },
      {
        "id": "v2-16",
        "volume": 2,
        "number": 16,
        "title": "First Hop Redundancy Protocols",
        "pages": [
          350,
          367
        ],
        "sections": [
          {
            "title": "First Hop Redundancy Protocols",
            "page": 352
          },
          {
            "title": "Hot Standby Router Protocol",
            "page": 356
          },
          {
            "title": "VRRP and GLBP Concepts",
            "page": 362
          },
          {
            "title": "Chapter Review",
            "page": 366
          }
        ],
        "hours": 3
      },
      {
        "id": "v2-17",
        "volume": 2,
        "number": 17,
        "title": "SNMP, FTP, and TFTP",
        "pages": [
          368,
          391
        ],
        "sections": [
          {
            "title": "Simple Network Management Protocol",
            "page": 370
          },
          {
            "title": "FTP and TFTP",
            "page": 376
          },
          {
            "title": "Chapter Review",
            "page": 388
          }
        ],
        "hours": 4
      }
    ]
  },
  {
    "id": "v2-p5",
    "volume": 2,
    "title": "Part V: Network Architecture",
    "milestone": "Describe campus, WAN and cloud designs and when to use each.",
    "chapters": [
      {
        "id": "v2-18",
        "volume": 2,
        "number": 18,
        "title": "LAN Architecture",
        "pages": [
          396,
          413
        ],
        "sections": [
          {
            "title": "Analyzing Campus LAN Topologies",
            "page": 398
          },
          {
            "title": "Ethernet Physical Media and Standards",
            "page": 403
          },
          {
            "title": "Small Office/Home Office",
            "page": 407
          },
          {
            "title": "Power over Ethernet (PoE)",
            "page": 408
          },
          {
            "title": "Chapter Review",
            "page": 412
          }
        ],
        "hours": 3
      },
      {
        "id": "v2-19",
        "volume": 2,
        "number": 19,
        "title": "WAN Architecture",
        "pages": [
          414,
          437
        ],
        "sections": [
          {
            "title": "Metro Ethernet",
            "page": 416
          },
          {
            "title": "Multiprotocol Label Switching (MPLS)",
            "page": 422
          },
          {
            "title": "Internet VPNs",
            "page": 425
          },
          {
            "title": "Chapter Review",
            "page": 435
          }
        ],
        "hours": 4
      },
      {
        "id": "v2-20",
        "volume": 2,
        "number": 20,
        "title": "Cloud Architecture",
        "pages": [
          438,
          465
        ],
        "sections": [
          {
            "title": "Server Virtualization",
            "page": 440
          },
          {
            "title": "Cloud Computing Services",
            "page": 448
          },
          {
            "title": "WAN Traffic Paths to Reach Cloud Services",
            "page": 456
          },
          {
            "title": "Understanding Cloud Management",
            "page": 460
          },
          {
            "title": "Chapter Review",
            "page": 465
          }
        ],
        "hours": 4
      }
    ]
  },
  {
    "id": "v2-p6",
    "volume": 2,
    "title": "Part VI: Network Automation",
    "milestone": "Explain SDN/SD-Access, read JSON, map CRUD to HTTP verbs, compare Ansible and Terraform.",
    "chapters": [
      {
        "id": "v2-21",
        "volume": 2,
        "number": 21,
        "title": "Introduction to Controller-Based Networking",
        "pages": [
          470,
          493
        ],
        "sections": [
          {
            "title": "SDN and Controller-Based Networks",
            "page": 472
          },
          {
            "title": "Examples of Network Programmability and SDN",
            "page": 481
          },
          {
            "title": "Comparing Traditional Versus Controller-Based Networks",
            "page": 488
          },
          {
            "title": "Chapter Review",
            "page": 492
          }
        ],
        "hours": 4
      },
      {
        "id": "v2-22",
        "volume": 2,
        "number": 22,
        "title": "Cisco Software-Defined Access (Cisco SD-Access)",
        "pages": [
          494,
          525
        ],
        "sections": [
          {
            "title": "Cisco SD-Access Fabric, Underlay, and Overlay",
            "page": 496
          },
          {
            "title": "Cisco Catalyst Center and Cisco SD-Access Operation",
            "page": 509
          },
          {
            "title": "Chapter Review",
            "page": 524
          }
        ],
        "hours": 5
      },
      {
        "id": "v2-23",
        "volume": 2,
        "number": 23,
        "title": "Understanding REST and JSON",
        "pages": [
          526,
          551
        ],
        "sections": [
          {
            "title": "REST-Based APIs",
            "page": 528
          },
          {
            "title": "Data Serialization and JSON",
            "page": 541
          },
          {
            "title": "Recognizing the Components of JSON",
            "page": 546
          },
          {
            "title": "Chapter Review",
            "page": 550
          }
        ],
        "hours": 4
      },
      {
        "id": "v2-24",
        "volume": 2,
        "number": 24,
        "title": "Understanding Ansible and Terraform",
        "pages": [
          552,
          567
        ],
        "sections": [
          {
            "title": "Device Configuration Challenges and Solutions",
            "page": 554
          },
          {
            "title": "Ansible and Terraform Basics",
            "page": 562
          },
          {
            "title": "Chapter Review",
            "page": 566
          }
        ],
        "hours": 3
      }
    ]
  },
  {
    "id": "v2-p7",
    "volume": 2,
    "title": "Part VII: Exam Updates and Final Review",
    "milestone": "Take full practice exams and close every remaining gap.",
    "chapters": [
      {
        "id": "v2-25",
        "volume": 2,
        "number": 25,
        "title": "Volume 2 (2nd ed.), Exam Updates",
        "pages": [
          572,
          577
        ],
        "sections": [
          {
            "title": "The Purpose of This Chapter",
            "page": 572
          },
          {
            "title": "News About the Next CCNA Exam Release",
            "page": 576
          },
          {
            "title": "Updated Technical Content",
            "page": 576
          }
        ],
        "hours": 1
      },
      {
        "id": "v2-26",
        "volume": 2,
        "number": 26,
        "title": "Final Review",
        "pages": [
          578,
          598
        ],
        "sections": [
          {
            "title": "Advice About the Exam Event",
            "page": 578
          },
          {
            "title": "Exam Review",
            "page": 584
          }
        ],
        "hours": 3
      }
    ]
  }
]

// Merge notes and reverse-map exam objectives onto every chapter
export const PARTS = RAW_PARTS.map((part) => ({
  ...part,
  chapters: part.chapters.map((c) => ({
    ...c,
    ...(NOTES[c.id] ?? { priority: 'standard', summary: '', keyPoints: [], commands: [] }),
    objectives: OBJECTIVES.filter((o) => o.chapters.includes(c.id)).map((o) => o.id),
  })),
}))

export const CHAPTERS = PARTS.flatMap((p) => p.chapters.map((c) => ({ ...c, partId: p.id, partTitle: p.title })))

export const chapterById = (id) => CHAPTERS.find((c) => c.id === id)

export const chapterLabel = (c) => `Vol ${c.volume}, Ch ${c.number}`
