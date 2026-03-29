# SwarmOps

> 중간발표 슬라이드: [`decks/swarmops-mid/`](decks/swarmops-mid/)

AI 구매자 에이전트 무리(swarm) 기반 셀러 최적화 대시보드.

상품 전략을 시장에 적용하기 전에, 800명의 AI 구매자로 미리 검증합니다.

## Commands

```bash
npm install
npm start                # http://127.0.0.1:3001/
npm test                 # unit tests (node:test)
npm run test:e2e         # E2E tests (Playwright)
```

## What It Does

- 셀러가 상품 제목 / 카피 / 가격을 수정하면, 8개 한국 소비자 아키타입에서 생성된 800명의 AI 구매자가 각각 독립적으로 LLM을 통해 구매 결정을 내림
- 매 Iteration마다 gpt-5.4가 전략 후보 3개를 제안하고, 800명이 평가하여 최적 전략을 선택
- 별도 200명 홀드아웃 검증으로 과적합 방지
- 결과를 Before/After Diff + 수익 예측으로 시각화

## Notes

- Node.js ESM (.mjs), vanilla HTML/CSS/JS — 프레임워크 없음
- gpt-5.4 (전략/판단) + gpt-5-nano (800개 개별 에이전트 평가)
- SSE 실시간 스트리밍 + Canvas 2D 파티클 애니메이션
- `OPENAI_API_KEY` 환경변수 필요 (live 모드)
- Playwright 기반 E2E 브라우저 검증
- Ouroboros 루프로 빌드 (PRD → Seed → Test Spec → 자동 빌드/검증)

## Team

**SwarmOps** · 손세호
