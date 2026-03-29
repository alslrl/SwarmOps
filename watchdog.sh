#!/bin/bash
# SwarmOps Ralph Loop Watchdog
# 해커톤 당일 실행: tmux에서 caffeinate -s ./watchdog.sh
# Claude Code 세션이 죽으면 자동 재시작

cd "$(dirname "$0")"
LOG_FILE="watchdog.log"
MAX_RESTARTS=20
RESTART_COUNT=0

COMPLETE_COUNT=0
REQUIRED_COMPLETES=2  # Ralph COMPLETE 2회 달성 후 종료

echo "=== SwarmOps Watchdog Started ===" | tee -a "$LOG_FILE"
echo "$(date): 노트북 덮어도 됩니다 🦞" | tee -a "$LOG_FILE"
echo "$(date): Ralph COMPLETE ${REQUIRED_COMPLETES}회 달성 시 종료" | tee -a "$LOG_FILE"

while [ $RESTART_COUNT -lt $MAX_RESTARTS ]; do
  RESTART_COUNT=$((RESTART_COUNT + 1))
  echo "" | tee -a "$LOG_FILE"
  echo "$(date): [Attempt $RESTART_COUNT/$MAX_RESTARTS] Ralph 세션 시작..." | tee -a "$LOG_FILE"

  script -q /dev/null claude -p 'ooo ralph "Build seller-war-game per seed.yaml. IMPORTANT: Start a NEW lineage from Gen 1. Do NOT continue from seller_war_game_build_001. Use lineage_id swarmops_hackathon_day."' --dangerously-skip-permissions --verbose 2>&1 | tee -a "$LOG_FILE"
  EXIT_CODE=${PIPESTATUS[0]}

  echo "" | tee -a "$LOG_FILE"
  echo "$(date): 세션 종료 (exit: $EXIT_CODE)" | tee -a "$LOG_FILE"

  # Ralph COMPLETE 감지 시 카운트 증가
  if grep -q "Ralph COMPLETE" "$LOG_FILE" 2>/dev/null; then
    COMPLETE_COUNT=$((COMPLETE_COUNT + 1))
    echo "$(date): ✅ Ralph 완료! (${COMPLETE_COUNT}/${REQUIRED_COMPLETES})" | tee -a "$LOG_FILE"

    if [ $COMPLETE_COUNT -ge $REQUIRED_COMPLETES ]; then
      echo "$(date): 🎉 ${REQUIRED_COMPLETES}회 완료 달성! 최종 종료." | tee -a "$LOG_FILE"
      break
    fi

    echo "$(date): 검증을 위해 한 번 더 실행합니다..." | tee -a "$LOG_FILE"
    sleep 5
    continue
  fi

  echo "$(date): 10초 후 재시작..." | tee -a "$LOG_FILE"
  sleep 10
done

echo "" | tee -a "$LOG_FILE"
echo "=== Watchdog 종료 (restarts: $RESTART_COUNT) ===" | tee -a "$LOG_FILE"
