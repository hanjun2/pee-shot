# 오줌 발싸 · pee shot

Django와 JavaScript/Three.js로 만든 브라우저 1인칭 액션 게임입니다. 집에서 시작해 화장실 전투로 이어집니다.

## 다운로드 및 설치

Python 3.11 이상이 필요합니다. Windows PowerShell 기준:

```powershell
git clone https://github.com/hanjun2/pee-shot.git
cd pee-shot
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r web_django/requirements.txt
.\.venv\Scripts\python.exe web_django/manage.py migrate
.\.venv\Scripts\python.exe web_django/serve_game.py
```

브라우저에서 http://127.0.0.1:8000/ 을 엽니다.

macOS / Linux에서는 `.\.venv\Scripts\python.exe` 대신 `.venv/bin/python`을 사용하세요.

Git이 없다면 저장소의 **Code → Download ZIP**으로 내려받고 압축을 푼 뒤, `README.md`가 있는 폴더에서 터미널을 여세요. 위 명령 중 `git clone`과 `cd pee-shot`을 건너뛰고 실행하면 됩니다.

## 다시 실행하기 / 종료하기

설치는 처음 한 번만 하면 됩니다. 다음부터는 프로젝트 폴더에서 아래 명령을 실행하세요.

```powershell
.\.venv\Scripts\python.exe web_django/serve_game.py
```

서버 터미널을 켜 둔 상태로 http://127.0.0.1:8000/ 에 접속합니다. 서버를 종료하려면 **서버 터미널에서 Ctrl+C**를 누르세요. 브라우저만 닫으면 서버는 계속 실행됩니다.

## 처음 플레이하는 방법

1. 로비의 **플레이 설정**에서 난이도, 일반 감도, 조준 감도와 그래픽을 선택합니다.
2. **혼자 전투 시작**을 누릅니다.
3. 집 탐색 화면에서 게임 화면을 클릭해 마우스를 고정하고, WASD로 이동합니다.
4. 화장실의 변기 앞에서 **Space**를 눌러 전투에 입장합니다. 바로 전투하고 싶으면 **바로 변기로 뛰어들기** 버튼을 사용하세요.
5. 전투 중에는 상단 임무 안내와 라운드 진행률을 확인하면서 적과 보스를 상대합니다. 혼자 플레이하거나 협동할 때는 **10라운드 완료**가 목표입니다.
6. **Esc**로 일시정지 메뉴를 열어 마우스를 풀거나 로비로 돌아갈 수 있습니다.

## 조작법

### 집 탐색

| 입력 | 동작 |
| --- | --- |
| WASD / 마우스 | 이동 / 시점 회전 |
| Shift 누르기 | 달리기 |
| Ctrl 누르기 | 앉기 |
| Space | 점프, 변기 앞에서는 전투 입장 |
| F | 주변 대상과 상호작용 |
| Esc | 일시정지 메뉴 |

### 전투

| 입력 | 동작 |
| --- | --- |
| WASD / 마우스 | 이동 / 조준 |
| 좌클릭 | 발사. 라이플은 누르고 있으면 연사 |
| 우클릭 | 정조준 |
| 1 | 저격총 선택 |
| 2 | 라이플 선택 |
| 3 → 좌클릭 | 획득한 휴지를 선택한 뒤 투척 |
| R | 재장전 |
| Ctrl 누르기 | 앉기 |
| Space | 점프 |
| E | 오줌 레이저 |
| Shift | 대시. 이동키 방향으로 회피하며, 방향 입력이 없으면 앞으로 이동 |
| Q | 궁극기 **똥 투하** |
| F | 뚫어뻥 근접 공격 |
| Esc / P | 일시정지 메뉴 |

현재 버전의 무기는 **저격총·라이플**, 투척 아이템은 **휴지**, 근접 공격은 **뚫어뻥**입니다. 이전 개발 버전의 권총·칼 조작과는 다릅니다.

### 스킬과 화면 읽기

- **E 레이저:** 조준한 방향으로 발사합니다. 다시 쓰려면 재사용 대기시간이 끝나야 합니다.
- **Shift 대시:** 짧게 빠르게 이동하며 공격을 회피합니다. 화면의 대시 준비 상태를 확인하세요.
- **Q 궁극기:** 화면의 궁극기 게이지를 채운 뒤 사용합니다.
- **휴지:** 전장에서 획득하면 `3`번 선택 안내가 표시됩니다. 수량이 있어야 던질 수 있습니다.
- **체력 / 탄약:** 화면 아래에서 확인합니다. 탄창이 비면 `R`로 재장전하세요.
- **임무 / 라운드 / 보스 체력:** 화면 위쪽의 안내에 따라 진행합니다.
- **음악·효과음·전체화면:** 화면 위 버튼으로 조절합니다. 느리다면 로비 그래픽을 **가벼움**으로 바꾸세요.

## 친구와 플레이하기

### 협동 모드

1. 같은 게임 서버에 접속합니다.
2. 로비에서 닉네임을 입력하고 **협동 방 만들기**를 누릅니다.
3. 표시되는 **6자리 방 코드**를 친구에게 알려줍니다.
4. 친구는 방 코드를 입력하고 **코드로 입장**을 누릅니다.
5. 함께 적과 보스를 상대하며 10라운드 완료를 목표로 진행합니다.

### 1대1 모드

**1대1 방 만들기**로 방을 만든 뒤 같은 방식으로 초대합니다. 먼저 **5킬**을 달성하면 승리합니다.

> `127.0.0.1`은 각자의 컴퓨터를 가리킵니다. 기본 실행 명령은 내 컴퓨터에서만 접속할 수 있도록 되어 있어, 이 주소를 친구에게 보내는 것만으로는 함께 플레이할 수 없습니다. 다른 컴퓨터에서 함께 하려면 접속 가능한 공용 게임 서버를 별도로 운영해야 합니다. 방 코드도 같은 서버에서만 유효합니다. 온라인 모드에서는 일시정지 메뉴를 열어도 다른 플레이어의 게임이 멈추지 않습니다.

## 실행이 안 될 때

| 증상 | 확인할 내용 |
| --- | --- |
| `python` 명령을 찾을 수 없음 | Python 3.11 이상을 설치하고 터미널을 다시 여세요. Windows에서 `py`가 된다면 가상환경 생성에 `py -3 -m venv .venv`를 사용해도 됩니다. |
| `No module named django` 또는 `waitress` | 설치 명령을 다시 실행하고, 전역 Python이 아닌 `.venv`의 Python으로 게임을 실행하세요. |
| `no such table` | `web_django/manage.py migrate` 명령을 실행하세요. |
| 페이지에 접속할 수 없음 | 서버 터미널의 오류를 확인하고 서버가 실행 중인지 확인하세요. |
| 포트 8000이 이미 사용 중 | 기존 게임 서버를 종료하거나 아래처럼 다른 포트를 지정하세요. |
| 마우스로 시점이 움직이지 않음 | 게임 화면을 클릭해 마우스를 고정하세요. Esc를 누르면 고정이 풀립니다. |

다른 포트로 실행하는 Windows PowerShell 예시:

```powershell
$env:PORT = "8001"
.\.venv\Scripts\python.exe web_django/serve_game.py
```

이 경우 접속 주소는 http://127.0.0.1:8001/ 입니다.

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
