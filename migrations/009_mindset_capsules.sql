-- migrations/009_mindset_capsules.sql
-- Camada 6: Cápsulas de Mindset Opt-In
-- Conteúdo curado, exclusivo Wingman Pro

-- ── Tabela de cápsulas (conteúdo curado) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS mindset_capsules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category      TEXT NOT NULL,
  body          TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  display_order INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mindset_capsules_category
  ON mindset_capsules(category, is_active);

-- ── Opt-in de cada usuário ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mindset_opt_ins (
  phone               TEXT PRIMARY KEY,
  enabled             BOOLEAN NOT NULL DEFAULT false,
  frequency           INT NOT NULL DEFAULT 3,      -- cápsulas por semana (1,3,5,7)
  schedule_days       INT[] NOT NULL DEFAULT '{1,3,5}',  -- ISO weekday: 1=Seg..7=Dom
  schedule_hour       INT NOT NULL DEFAULT 9,       -- hora BRT
  first_pro_at        TIMESTAMPTZ,                  -- quando detectamos Pro pela primeira vez
  invite_sent_at      TIMESTAMPTZ,
  invite_declined_at  TIMESTAMPTZ,
  opted_in_at         TIMESTAMPTZ,
  opted_out_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Histórico de entregas ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mindset_deliveries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,
  capsule_id  UUID NOT NULL REFERENCES mindset_capsules(id) ON DELETE CASCADE,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mindset_deliveries_phone
  ON mindset_deliveries(phone, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_mindset_deliveries_capsule
  ON mindset_deliveries(capsule_id);

-- ── View de estatísticas ──────────────────────────────────────────────────────
CREATE OR REPLACE VIEW mindset_stats AS
SELECT
  COUNT(DISTINCT phone) FILTER (WHERE enabled = true)   AS opted_in_users,
  COUNT(DISTINCT phone) FILTER (WHERE enabled = false
    AND opted_in_at IS NOT NULL)                         AS opted_out_users,
  COUNT(DISTINCT phone) FILTER (WHERE invite_sent_at IS NOT NULL
    AND opted_in_at IS NULL
    AND invite_declined_at IS NULL)                      AS invite_pending,
  COUNT(DISTINCT phone)                                  AS total_reached
FROM mindset_opt_ins;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: 30 cápsulas curadas (3 por categoria) para teste inicial
-- ATENÇÃO: revisar e expandir para 100 antes do lançamento
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO mindset_capsules (category, body, display_order) VALUES

-- postura_masculina_madura
('postura_masculina_madura',
'Postura não é linguagem corporal. É o conjunto de como você age quando ela demora, quando ela cancela, quando ela te desafia. Homem com postura mantém o rumo sem virar pedra e sem virar esponja.',
1),
('postura_masculina_madura',
'Você não precisa impressionar ela. Você precisa ser interessante. Impressionar é ansiedade disfarçada de esforço. Ser interessante é viver uma vida que vale a pena contar.',
2),
('postura_masculina_madura',
'O cara que fica disponível o tempo todo não parece dedicado. Parece que não tem mais nada pra fazer.',
3),

-- lidar_com_rejeicao
('lidar_com_rejeicao',
'Rejeição dói porque você se importou o suficiente pra tentar. Isso não é fraqueza — é coragem. O problema não é sentir, é interpretar rejeição como prova de que você não vale.',
1),
('lidar_com_rejeicao',
'Ela disse não. Tá. Isso não define você. Define que vocês não encaixaram agora, ou que o timing era errado. Mais nada.',
2),
('lidar_com_rejeicao',
'Quando ela não responde, é fácil criar uma história — que você fez algo errado, que ela te despreza, que você não é suficiente. Mas você não sabe. Você só sabe que ela não respondeu.',
3),

-- construir_abundancia
('construir_abundancia',
'Abundância não é ter muitas mulheres. É não precisar daquela. Você só chega lá quando sua vida tá cheia de outras coisas — trabalho, amigos, projeto, movimento. Não é técnica. É vida real.',
1),
('construir_abundancia',
'Quando você sabe que vai ter outra conversa, outro match, outra chance — você para de segurar cada interação com as duas mãos. E aí, curiosamente, as coisas ficam mais tempo.',
2),
('construir_abundancia',
'Escassez de opções faz você tolerar coisas que não devia. Não porque você é idiota — porque quando parece que é a única, qualquer coisa parece aceitável.',
3),

-- honestidade_emocional
('honestidade_emocional',
'Você tá com raiva, frustrado, inseguro — isso é humano. O erro é fingir que não tá. Fingir não resolve nada. E ela percebe mesmo assim.',
1),
('honestidade_emocional',
'Há diferença entre compartilhar e despejar. Compartilhar é "eu tô numa fase de readaptação." Despejar é contar toda a história do divórcio na segunda mensagem. Uma abre conversa. A outra fecha.',
2),
('honestidade_emocional',
'Você não precisa ser forte o tempo todo. Mas tem que ser honesto. Honestidade emocional não é mostrar tudo — é não fingir ser quem não é.',
3),

-- identidade_pos_divorcio
('identidade_pos_divorcio',
'O homem que saiu do casamento não é o mesmo que entrou. Isso não é perda — é dado. A questão é quem você quer ser agora. Não pra ela. Pra você.',
1),
('identidade_pos_divorcio',
'Ter filhos, ter história, ter cicatrizes — isso não é bagagem que você esconde. É contexto. Apresenta sem desculpa, sem drama. Quem é certo pra você aceita o pacote.',
2),
('identidade_pos_divorcio',
'Voltar ao mercado depois de anos é estranho. O ritmo mudou, as plataformas mudaram, você mudou. Isso não é desvantagem — você tem algo que cara de 25 não tem: você já sabe o que não quer.',
3),

-- equilibrio_paquera_vida
('equilibrio_paquera_vida',
'Paquera é uma parte da vida. Não é a mais importante. Quando vira a central — quando o dia gira inteiro em torno de se ela respondeu — você perdeu o equilíbrio. E ela sente isso.',
1),
('equilibrio_paquera_vida',
'O cara mais atraente num bar não é o que fica tentando. É o que tá realmente presente na conversa com os amigos. Presença real atrai. Performance repele.',
2),
('equilibrio_paquera_vida',
'Checar se ela está online é hábito de ansiedade, não de interesse genuíno. Interesse real é querer saber como ela é. Ansiedade quer controlar o resultado.',
3),

-- ler_intencao_dela
('ler_intencao_dela',
'Quando ela responde rápido, pergunta coisas, manda emoji que abrem espaço — ela tá engajada. Quando responde com uma ou duas palavras, sem pergunta de volta — ela tá sendo educada. Tem diferença.',
1),
('ler_intencao_dela',
'Ela cancelou com antecedência e propôs nova data — isso é interesse. Ela cancelou em cima da hora sem alternativa — isso é sinal. Você decide o que fazer com cada um.',
2),
('ler_intencao_dela',
'Não analisa ela nos momentos ruins. Analisa o padrão. Um dia fria não significa nada. Três semanas fria é informação.',
3),

-- boundaries_saudaveis
('boundaries_saudaveis',
'Limite não é punição. Você não sai quieto pra castigá-la. Você sai quieto porque tem outras coisas pra fazer e não precisa ficar esperando. Ela percebe a diferença.',
1),
('boundaries_saudaveis',
'Aceitar comportamento que te incomoda porque você não quer perder a chance não é paciência. É fazer um trato com você mesmo que vai cobrar caro no futuro.',
2),
('boundaries_saudaveis',
'Você pode gostar de alguém e ainda decidir que o jeito como ela age não funciona pra você. As duas coisas são verdade ao mesmo tempo.',
3),

-- quando_insistir_soltar
('quando_insistir_soltar',
'A regra simples: você tenta duas vezes, com tempo razoável entre as tentativas. Se ela não responde à segunda, você soltou. Não é desistir — é respeitar o sinal.',
1),
('quando_insistir_soltar',
'Insistir além do ponto não muda o resultado. Muda a percepção que ela tem de você. E raramente muda pra melhor.',
2),
('quando_insistir_soltar',
'Soltar não é fraqueza. É reconhecer que você não controla o interesse de outra pessoa. O que você controla é como você usa seu tempo e energia.',
3),

-- auto_percepcao
('auto_percepcao',
'Auto-percepção não é ficar se avaliando o tempo todo. É saber quando você tá agindo com medo, quando tá agindo com raiva e quando tá agindo com clareza. Os resultados são muito diferentes.',
1),
('auto_percepcao',
'Você provavelmente tem um padrão que atrapalha. Todo mundo tem. O negócio é identificar qual é o seu antes de repetir na próxima vez.',
2),
('auto_percepcao',
'Difícil é perceber quando você tá contando a história conveniente pra você, não o que realmente aconteceu. Ela foi grossa ou você chegou esperando rejeição?',
3);
