shubix/                                      # Monorepo: pnpm Workspaces
│
├── FE/                                      # Frontend
│   │
│   ├── web-app/                             # Next.js + React + TypeScript
│   │   ├── app/                             # Next.js App Router
│   │   ├── components/                      # React + Tailwind CSS
│   │   ├── public/                          # Static Assets
│   │   ├── next.config.ts                   # Next.js Configuration
│   │   └── package.json                     # Dependencies
│   │
│   └── mobile-app/                          # React Native + Expo + TypeScript
│       ├── app/                             # Expo Router
│       ├── components/                      # React Native UI
│       ├── assets/                          # Images, Fonts, Icons
│       ├── app.json                         # Expo Configuration
│       └── package.json                     # Dependencies
│
├── BE/                                      # Backend
│   │
│   └── api/                                 # NestJS + Node.js + TypeScript
│       ├── src/
│       │   ├── auth/                        # JWT + Passport
│       │   ├── users/                       # User Management
│       │   ├── reels/                       # Reel APIs
│       │   ├── subscriptions/                # Subscription Management
│       │   ├── payments/                    # Payment Gateway Integration
│       │   ├── database/                    # Prisma ORM
│       │   └── main.ts                      # NestJS Entry Point
│       ├── test/                             # Jest + E2E Tests
│       └── package.json                     # Dependencies
│
├── Shared/                                  # Shared Workspace Packages
│   │
│   ├── types/                               # TypeScript Interfaces + Types
│   ├── validations/                         # Zod Schemas
│   ├── api-client/                          # TypeScript + Fetch
│   ├── utils/                               # TypeScript Utility Functions
│   ├── ui-core/                             # Design Tokens + Theme
│   ├── ui-web/                              # React + Tailwind CSS
│   └── ui-mobile/                           # React Native Components
│
├── package.json                             # pnpm Workspace Scripts
├── pnpm-workspace.yaml                      # Workspace Configuration
├── tsconfig.base.json                       # Shared TypeScript Config
├── .gitignore                               # Git Ignore Rules
├── .env.example                             # Environment Variables Template
└── README.md                                # Project Documentation