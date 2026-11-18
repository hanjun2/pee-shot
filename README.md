# 오줌 발싸 · FLUSH PROTOCOL

Django와 JavaScript/Three.js로 만든 브라우저 1인칭 액션 게임입니다. 집에서 시작해 화장실 전투로 이어집니다.

## 로컬 실행

Python 3.11 이상이 필요합니다. Windows PowerShell 기준:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r web_django/requirements.txt
.\.venv\Scripts\python.exe web_django/manage.py migrate
.\.venv\Scripts\python.exe web_django/serve_game.py
```

브라우저에서 http://127.0.0.1:8000/ 을 엽니다.

macOS / Linux에서는 `.\.venv\Scripts\python.exe` 대신 `.venv/bin/python`을 사용하세요.

## 조작

- WASD: 이동 / 마우스: 조준
- 좌클릭: 발사 / 우클릭: 정조준
- 1, 2: 저격총, 라이플 전환
- R: 재장전 / Ctrl: 앉기 / Space: 점프
- E: 감속 레이저 / Shift: 대시 / Q: 궁극기 / F: 근접 공격

모드별 안내는 게임 화면을 참고하세요.

## 프로젝트 구성

- `web_django/game`: 게임 API, 모델, 마이그레이션, 테스트
- `web_django/static/game`: 게임 로직, 스타일, 렌더러, 음원
- `web_django/templates/game`: 게임 화면
- `web_django/serve_game.py`: 로컬 실행 서버

## 검사

```powershell
.\.venv\Scripts\python.exe web_django/manage.py check
.\.venv\Scripts\python.exe web_django/manage.py collectstatic --noinput
.\.venv\Scripts\python.exe web_django/manage.py test game
```

DB, 실행 로그, 수집된 정적 파일과 이전 버전 백업은 저장소에 포함하지 않습니다. DB는 `migrate` 명령으로 생성합니다. 로컬 서버는 시작할 때 정적 파일을 수집합니다.

이 프로젝트는 Django 서버가 필요하므로 GitHub Pages만으로 전체 게임을 실행할 수는 없습니다. 인터넷에 배포할 때는 `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `DJANGO_DEBUG=0` 등 서버 환경변수를 별도로 설정하세요.

## 외부 라이브러리

Three.js 라이선스는 `web_django/static/game/vendor/THREE-LICENSE.txt`에 포함되어 있습니다.
